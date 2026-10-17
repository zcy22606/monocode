/**
 * 电脑上的会话（网关里的镜像）：先拿最后一段，往上翻再多要。手机只是遥控器（D-22）：
 * 发的消息交给电脑跑（它自己的会话，「进行中」、用时照常），手机留在这页实时看；电脑不在线就只能看。
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getMirror, mirrorFiles, relayMirror, stopMirrorJob, type HostModelCatalog, type MirrorSession } from "../host/host";
import { FileSourceContext } from "../host/files";
import { cached, usePoll } from "../host/poll";
import type { HostError } from "../host/rpc";
import { ago, t, useTranslation } from "../i18n";
import { Icon } from "../ui/icons";
import { ActionButton, AutoTextarea } from "../ui/inputs";
import { Spinner, haptic, toast } from "../ui/kit";
import { useActive, useNav, type Route } from "../ui/nav";
import { BackgroundJobs, DaySeparator, UserBubble, WorkGroup, cleanTitle, visibleBlock } from "./blocks";
import { groupWork } from "../ui/activity";
import { modelName } from "./ModelSheet";
import { BlockView, newDay, useNow } from "./Session";
import { SessionFiles } from "./File";
import { IssueStrip, NewIssueSheet, useProjectIssues } from "./Issues";
import { useSheet } from "../ui/kit";
import { Shimmer } from "../ui/desktop";

const PAGE = 120;
/** 发给电脑的消息这么久还没出现在电脑的会话里，就标成没发出去，让用户重发。 */
const DELIVERY_TIMEOUT = 90_000;

/** 发给电脑、还没在电脑会话里出现的消息。after = 发出时最后一块的 id，在它之后出现同样的话就算到了。 */
type Pending = { id: string; text: string; sentAt: number; after?: string; failed?: boolean };

export function MirrorScreen({ route }: { route: Extract<Route, { name: "mirror" }> }) {
  useTranslation();
  const active = useActive();
  const nav = useNav();
  const [tail, setTail] = useState(PAGE);
  const [pending, setPending] = useState<Pending[]>([]);
  const known = useRef<{ tail: number; value: MirrorSession } | null>(null);
  const poll = usePoll(
    `mirror-session:${route.id}:${tail}`,
    async () => {
      const same = known.current?.tail === tail ? known.current.value : undefined;
      const result = await getMirror(route.id, same?.revision, tail);
      if ("unchanged" in result) {
        const jobsKey = (jobs?: { id: string; title: string; command?: string }[]) => (jobs ?? []).map((j) => `${j.id}:${j.title}:${j.command ?? ""}`).join("|");
        if (result.online !== same!.online || result.busy !== same!.busy || jobsKey(result.jobs) !== jobsKey(same!.jobs))
          known.current = { tail, value: { ...same!, online: result.online, busy: result.busy, jobs: result.jobs } };
        return known.current!.value;
      }
      known.current = { tail, value: result };
      return result;
    },
    // 等电脑接手、电脑正在跑时看得勤一点（电脑每秒推一次正在跑的这一轮）
    (m) => (pending.length || busyOf(m) ? 1500 : 5000),
    active,
  );
  const mirror = poll.data;
  const blocks = useMemo(() => (mirror?.session.blocks ?? []).filter(visibleBlock), [mirror]);
  const lastAssistant = [...blocks].reverse().find((b) => b.role === "assistant");
  const earlier = mirror ? mirror.totalBlocks - mirror.session.blocks.length : 0;
  const desktopBusy = busyOf(mirror);
  // 电脑上正在跑的这一轮：它的用户消息下面换成流光的「工作中」
  const turnUser = desktopBusy ? [...(mirror?.session.blocks ?? [])].reverse().find((b) => b.role === "user") : undefined;
  const now = useNow(active && (desktopBusy || pending.length > 0));
  // 后台任务的已运行时间每秒走
  const jobsNow = useNow(active && !!mirror?.jobs?.length);
  const cwd = mirror ? (mirror.session.worktreeCwd ?? mirror.cwd) : undefined;
  // 会话和 issue 挂钩（SOL-100）：挂了的顶上一条，没挂的回答下面「转成 issue」
  const issues = useProjectIssues(mirror?.cwd, active);
  const linked = issues.data?.sessionIssues[route.id];
  const toIssue = useSheet<true>();
  const fileSource = useMemo(() => (cwd ? { source: "mirror" as const, id: route.id, cwd } : null), [route.id, cwd]);

  // 电脑会话里出现了同样的话：那条就到了
  useEffect(() => {
    if (!mirror) return;
    const all = mirror.session.blocks;
    setPending((list) => {
      const next = list.filter((p) => {
        const from = p.after ? all.findIndex((b) => b.id === p.after) + 1 : 0;
        return !all.slice(from).some((b) => b.role === "user" && b.text.trim() === p.text);
      });
      return next.length === list.length ? list : next;
    });
  }, [mirror]);
  useEffect(() => {
    if (pending.some((p) => !p.failed && now - p.sentAt > DELIVERY_TIMEOUT))
      setPending((list) => list.map((p) => (!p.failed && now - p.sentAt > DELIVERY_TIMEOUT ? { ...p, failed: true } : p)));
  }, [now]);

  // ---------- 发消息 ----------
  const offline = !!mirror && !mirror.online;
  const [text, setText] = useState("");
  const send = async (value: string, id = crypto.randomUUID()) => {
    const after = mirror?.session.blocks.at(-1)?.id;
    setPending((list) => [...list.filter((p) => p.id !== id), { id, text: value, sentAt: Date.now(), after }]);
    stick.current = true;
    // 网络超时不知道网关收没收到：同一个 id 再发是安全的（网关按它去重）
    let relayed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        relayed = (await relayMirror(route.id, value, id)).relayed;
        break;
      } catch (e) {
        const error = e as HostError;
        if (error.kind === "network" && attempt < 3) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        else {
          setPending((list) => list.map((p) => (p.id === id ? { ...p, failed: true } : p)));
          toast(error.message);
          return;
        }
      }
    }
    if (relayed) return void poll.refresh();
    // 刚好下线了：放回输入框，连上再发
    setPending((list) => list.filter((p) => p.id !== id));
    setText(value);
    toast(t("mirror.offline"));
    poll.refresh();
  };
  const submit = () => {
    const value = text.trim();
    if (!value || offline) return;
    haptic();
    setText("");
    void send(value);
  };

  // 第一次到底部；之后在底部就跟着新内容走，加载更早的时保持当前位置
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const keepFrom = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop += el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [mirror, pending.length]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-stroke pb-1.5 pl-1 pr-3" style={{ paddingTop: "calc(var(--safe-top) + 6px)" }}>
        <button aria-label="back" className="press grid size-11 shrink-0 place-items-center rounded-full text-content/70 active:bg-selection" onClick={nav.back}>
          <Icon name="back" size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">{cleanTitle(route.title ?? "") || t("session.untitled")}</div>
          <div className="truncate text-xs text-content/45">
            {mirror ? `${modelName(cached<HostModelCatalog>(`models:${route.projectId}`), mirror.model)} · ` : ""}
            {t("mirror.synced", { machine: mirror?.machine ?? route.machine ?? "", time: mirror ? ago(mirror.pushedAt) : "…" })}
          </div>
        </div>
        <SessionFiles source={fileSource} load={() => mirrorFiles(route.id)} />
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-selection px-2.5 py-1 text-[12px] text-content/55">
          <Icon name="computer" size={13} /> {t("mirror.badge")}
        </span>
      </header>
      {linked && mirror ? (
        <IssueStrip issue={linked} onOpen={() => nav.push({ name: "issue", cwd: mirror.cwd, id: linked.id, ident: linked.ident, projectId: route.projectId })} />
      ) : null}

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current!;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scroll-y min-h-0 flex-1 px-4 pb-4 pt-3"
      >
        {!mirror ? (
          <div className="flex justify-center pt-16 text-content/40">
            <Spinner size={20} />
          </div>
        ) : null}
        {earlier > 0 ? (
          <button
            className="press mx-auto mb-3 block rounded-full bg-selection px-3 py-1.5 text-[12px] text-content/60"
            onClick={() => {
              keepFrom.current = scroller.current?.scrollHeight ?? null;
              setTail((n) => n + PAGE);
            }}
          >
            {t("session.earlier", { count: earlier })}
          </button>
        ) : null}
        <FileSourceContext.Provider value={fileSource}>
        <div className="flex flex-col gap-3">
          {groupWork(blocks).map((item, n, items) =>
            "steps" in item ? (
              <WorkGroup key={item.steps[0].id} steps={item.steps} cwd={cwd} active={desktopBusy && n === items.length - 1} />
            ) : (
              <Fragment key={item.block.id}>
                {newDay(blocks, item.index) ? <DaySeparator at={item.block.startedAt!} /> : null}
                <BlockView
                  block={item.block}
                  copyable={!desktopBusy && item.block === lastAssistant}
                  now={item.block === turnUser ? now : undefined}
                  cwd={cwd}
                  actions={
                    item.block === lastAssistant && !desktopBusy && !linked && issues.data ? (
                      <button className="press flex h-8 items-center gap-1 rounded-md px-1.5 text-[13px] text-accent" onClick={() => toIssue.open(true)}>
                        <Icon name="add" size={14} />
                        {t("issues.toIssue")}
                      </button>
                    ) : undefined
                  }
                />
              </Fragment>
            ),
          )}
          {pending.map((p) => (
            <div key={p.id} className="rise-in">
              <UserBubble
                text={p.text}
                state={p.failed ? "failed" : "sending"}
                onRetry={() => {
                  setPending((list) => list.filter((x) => x.id !== p.id));
                  void send(p.text);
                }}
              />
              {p.failed ? null : (
                <div className="mt-3">
                  <Shimmer className="text-[14px]" duration={1.6}>
                    {t("mirror.delivering")}
                  </Shimmer>
                </div>
              )}
            </div>
          ))}
        </div>
        </FileSourceContext.Provider>
      </div>

      {mirror ? (
        <NewIssueSheet
          open={!!toIssue.value}
          onClose={toIssue.close}
          cwd={mirror.cwd}
          data={issues.data ?? undefined}
          title={cleanTitle(route.title ?? "")}
          sessionId={route.id}
          onCreated={() => void issues.refresh()}
        />
      ) : null}
      <BackgroundJobs jobs={mirror?.jobs} now={jobsNow} onStop={offline ? undefined : (jobId) => stopMirrorJob(route.id, jobId)} />
      <div className="shrink-0 border-t border-stroke bg-background-base px-3 pt-2" style={{ paddingBottom: "calc(var(--safe-bottom) + 10px)" }}>
        <div className={`mb-2 flex items-center gap-1.5 px-1 text-xs ${offline ? "text-amber/80" : "text-content/40"}`}>
          <Icon name={offline ? "offline" : "computer"} size={13} className="shrink-0" />
          <span className="truncate">{offline ? t("mirror.offline") : t("mirror.hint")}</span>
        </div>
        <div className="flex items-end gap-2">
          <AutoTextarea value={text} disabled={!mirror || offline} onChange={(e) => setText(e.target.value)} placeholder={t("mirror.placeholder")} />
          <ActionButton mode="send" disabled={!text.trim() || offline} onClick={submit} />
        </div>
      </div>
    </div>
  );
}

/**
 * 电脑上这一轮还在跑：电脑每秒推一次正在跑的这一轮（busy）。老版本的电脑只在一轮开始和结束时存盘，
 * 最后一块是还没记用时的用户消息也算在跑；停在那儿太久的不算（多半是电脑那边断了）。
 */
function busyOf(mirror: MirrorSession | undefined) {
  const last = mirror?.session.blocks.at(-1);
  if (!mirror || !last) return false;
  if (mirror.busy) return true;
  if (last.streaming) return Date.now() - mirror.updatedAt < 10 * 60_000;
  return last.role === "user" && !last.durationMs && !!last.startedAt && Date.now() - last.startedAt < 3 * 3600_000;
}
