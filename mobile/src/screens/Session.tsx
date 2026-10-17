/** 会话页：实时对话、审批和提问、发消息（跑着时排队）、停止、换模型。 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  answer,
  approve,
  configure,
  createSession,
  listModels,
  loadSession,
  send,
  stop,
  type Block,
  type HostSession,
  type UserQuestion,
  type UserQuestionReply,
} from "../host/host";
import { cached, usePoll } from "../host/poll";
import type { HostError } from "../host/rpc";
import { useApp } from "../app-context";
import { t, useTranslation } from "../i18n";
import { markSeen, type ModelChoice } from "../prefs";
import { Icon } from "../ui/icons";
import { ActionButton, AutoTextarea } from "../ui/inputs";
import { Dot, Spinner, haptic, toast, useSheet } from "../ui/kit";
import { useActive, useNav, type Route } from "../ui/nav";
import { CopyButton, DaySeparator, ImageBlock, ShellRow, WorkGroup, Markdown, Reasoning, SystemRow, TaskList, ToolRow, TurnDone, UserBubble, WorkingLine, cleanTitle, visibleBlock } from "./blocks";
import { toolLabel } from "../ui/desktop";
import { groupWork } from "../ui/activity";
import { FileSourceContext, fileError } from "../host/files";
import { useViewing } from "../host/notify";
import { sessionFiles } from "../../../soloyard/core/src/session-files";
import { SessionFiles } from "./File";
import { ModelChip, ModelSheet, modelName } from "./ModelSheet";

type Outgoing = { id: string; text: string; state: "sending" | "queued" | "failed" };
const PAGE = 80;

export function SessionScreen({ route }: { route: Extract<Route, { name: "session" }> }) {
  useTranslation();
  const active = useActive();
  const nav = useNav();
  const { online } = useApp();
  const [sessionId, setSessionId] = useState(route.sessionId);
  useViewing(sessionId, active);
  const [outbox, setOutbox] = useState<Outgoing[]>(() => (route.start ? [{ id: route.start.commandId, text: route.start.text, state: "sending" }] : []));
  const known = useRef<HostSession | undefined>(sessionId ? cached(`session:${sessionId}`) : undefined);
  const poll = usePoll(
    sessionId ? `session:${sessionId}` : null,
    async () => (known.current = await loadSession(sessionId!, known.current)),
    (s) => (s?.session.busy || s?.status === "running" ? 500 : 2500),
    active,
  );
  const host = poll.data;
  const session = host?.session;
  const busy = !!(session?.busy || host?.status === "running");
  const catalog = usePoll(`models:${route.projectId}`, () => listModels(route.projectId), () => 300_000, active);

  // 跑着时选的新模型，这一轮结束后先换它
  const [nextModel, setNextModel] = useState<ModelChoice | null>(null);

  // ---------- 发消息 ----------
  const mark = (id: string, state: Outgoing["state"] | null) =>
    setOutbox((list) => (state ? list.map((m) => (m.id === id ? { ...m, state } : m)) : list.filter((m) => m.id !== id)));
  const deliver = (target: string, m: Pick<Outgoing, "id" | "text">, attempt = 0) => {
    mark(m.id, "sending");
    send(target, m.text, m.id)
      .then(() => poll.refresh())
      .catch((e: HostError) => {
        // 主机说这一轮还在跑：放回队列，跑完再发
        if (/already running/i.test(e.message)) mark(m.id, "queued");
        // 网络超时不知道主机收没收到：同一个 commandId 再发一次是安全的（主机按它去重），过一会儿自己重发
        else if (e.kind === "network" && attempt < 4) setTimeout(() => deliver(target, m, attempt + 1), 3000 * 2 ** attempt);
        else {
          mark(m.id, "failed");
          toast(e.message);
        }
      });
  };

  // 从首页新开的会话：进来再建，第一条消息先显示着
  const started = useRef(false);
  const begin = () => {
    const start = route.start;
    if (!start) return;
    if (route.sessionId) return deliver(route.sessionId, { id: start.commandId, text: start.text });
    mark(start.commandId, "sending");
    createSession(route.projectId, start.draft!)
      .then((id) => {
        setSessionId(id);
        deliver(id, { id: start.commandId, text: start.text });
      })
      .catch((e: HostError) => {
        mark(start.commandId, "failed");
        toast(e.message);
      });
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    begin();
  }, []);

  // 主机上出现了同 id 的消息块，乐观显示的那条就功成身退
  useEffect(() => {
    if (!session) return;
    const ids = new Set(session.blocks.map((b) => b.id));
    setOutbox((list) => (list.some((m) => ids.has(m.id)) ? list.filter((m) => !ids.has(m.id)) : list));
  }, [session]);

  // 这一轮结束了，把排队的发出去（一次一条）。要换模型的先换，排队的消息用新模型。
  useEffect(() => {
    if (busy || !sessionId || nextModel) return;
    const next = outbox.find((m) => m.state === "queued");
    if (next && !outbox.some((m) => m.state === "sending")) deliver(sessionId, next);
  }, [busy, outbox, sessionId, nextModel]);

  const [text, setText] = useState("");
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    haptic();
    setText("");
    const m: Outgoing = { id: crypto.randomUUID(), text: value, state: busy || !sessionId ? "queued" : "sending" };
    setOutbox((list) => [...list, m]);
    if (m.state === "sending") deliver(sessionId!, m);
    stick.current = true;
  };
  const retry = (m: Outgoing) => {
    if (!sessionId && route.start?.commandId === m.id) return begin();
    if (sessionId) deliver(sessionId, m);
  };

  const [stopping, setStopping] = useState(false);
  const halt = () => {
    if (!sessionId || !host?.runId) return;
    haptic(12);
    setStopping(true);
    stop(sessionId, host.runId)
      .then(() => poll.refresh())
      .catch((e: HostError) => toast(e.message))
      .finally(() => setStopping(false));
  };

  // ---------- 换模型：同一个提供方里；跑着时等这一轮结束 ----------
  const sheet = useSheet<"model">();
  const cwd = session ? (session.worktreeCwd ?? session.cwd) : undefined;
  const fileSource = useMemo(() => (sessionId && cwd ? { source: "host" as const, id: sessionId, cwd } : null), [sessionId, cwd]);
  const current: ModelChoice | null = session ? { harness: session.harness, model: session.model, settings: session.modelSettings ?? {} } : route.start?.draft ? { ...route.start.draft } : null;
  const apply = (choice: ModelChoice) => {
    if (!sessionId || !session) return;
    configure(sessionId, choice.model, choice.settings, session.runtimeMode)
      .then(() => {
        setNextModel(null);
        toast(t("session.modelChanged", { name: modelName(catalog.data, choice.model) }));
        return poll.refresh();
      })
      .catch((e: HostError) => {
        // 换不成就别挡着排队的消息
        setNextModel(null);
        toast(e.message);
      });
  };
  useEffect(() => {
    if (!busy && nextModel) apply(nextModel);
  }, [busy, nextModel]);

  // ---------- 看过了 ----------
  useEffect(() => {
    if (active && sessionId && host) markSeen(sessionId, host.updatedAt);
  }, [active, sessionId, host?.updatedAt]);

  // ---------- 滚动：在底部就一直跟着，往上翻了就显示「新消息」 ----------
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const blocks = useMemo(() => (session?.blocks ?? []).filter(visibleBlock), [session]);
  const shown = blocks.slice(-limit);
  const pending = outbox.filter((m) => !session?.blocks.some((b) => b.id === m.id));
  const last = blocks[blocks.length - 1];
  const signature = `${blocks.length}:${last?.text.length ?? 0}:${last?.tool?.status ?? ""}:${pending.length}:${busy}`;
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) {
      const far = el.scrollHeight - el.scrollTop - el.clientHeight > 800;
      el.scrollTo({ top: el.scrollHeight, behavior: first.current || far ? "auto" : "smooth" });
      first.current = !session;
    } else setUnseen(true);
  }, [signature]);
  const onScroll = () => {
    const el = scroller.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(false);
  };
  const toBottom = () => {
    haptic(4);
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  };
  const showEarlier = () => {
    const el = scroller.current!;
    const before = el.scrollHeight;
    setLimit((n) => n + PAGE);
    requestAnimationFrame(() => (el.scrollTop += el.scrollHeight - before));
  };

  const approval = blocks.find((b) => b.approval && !b.approval.decided);
  const question = session?.pendingQuestion;
  const lastAssistant = [...blocks].reverse().find((b) => b.role === "assistant");
  const waiting = !!(approval || question);
  const status = !online ? "offline" : waiting ? "input" : busy ? "running" : host?.status === "interrupted" ? "interrupted" : null;
  const title = cleanTitle(session?.title || route.title || "") || t("session.untitled");
  // 这一轮跑了多久（底部状态条上显示）
  // 正在跑的这一轮：它的用户消息下面显示流光的「工作中」，每秒走一下
  const turnUser = busy ? [...(session?.blocks ?? [])].reverse().find((b) => b.role === "user") : undefined;
  const now = useNow(!!turnUser?.startedAt && active);

  // 打开会话时已经有的块不做入场动画，之后新来的轻轻浮上来
  const initial = useRef<Set<string> | null>(null);
  if (!initial.current && session) initial.current = new Set(session.blocks.map((b) => b.id));

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-stroke pb-1.5 pl-1 pr-3" style={{ paddingTop: "calc(var(--safe-top) + 6px)" }}>
        <button aria-label="back" className="press grid size-11 shrink-0 place-items-center rounded-full text-content/70 active:bg-selection" onClick={nav.back}>
          <Icon name="back" size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">{title}</div>
          <div className="truncate text-xs text-content/45">
            {current ? modelName(catalog.data, current.model) : ""}
            {session?.branch ? ` · ${session.branch}` : ""}
          </div>
        </div>
        {status ? (
          <span
            className={`fade-in flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ${
              status === "running" ? "bg-accent/12 text-accent" : status === "input" ? "bg-amber/12 text-amber" : status === "interrupted" ? "bg-red/12 text-red" : "bg-selection text-content/50"
            }`}
          >
            <Dot tone={status === "running" ? "running" : status === "input" ? "input" : status === "interrupted" ? "error" : "idle"} className="!size-1.5" />
            {t(`session.status.${status}`)}
          </span>
        ) : null}
        <SessionFiles source={fileSource} load={async () => (session && cwd ? sessionFiles(session.blocks, cwd) : [])} />
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="scroll-y h-full px-4 pb-4 pt-3">
          {/* 打开已有的会话时转圈；刚从首页开的新会话没有历史，只显示发出的那条 */}
          {!session && (!pending.length || (poll.error && sessionId)) ? (
            poll.error && sessionId ? (
              <div className="flex flex-col items-center gap-3 pb-6 pt-16 text-center text-[13px] text-content/50">
                {fileError(poll.error)}
                <button className="press rounded-full bg-selection px-4 py-2 text-[13px] text-content/80" onClick={() => void poll.refresh()}>
                  {t("files.retry")}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 pb-6 pt-16 text-content/40">
                <Spinner size={20} />
                {sessionId ? <span className="text-xs">{t("session.loading")}</span> : null}
              </div>
            )
          ) : null}
          {blocks.length > shown.length ? (
            <button className="press mx-auto mb-3 block rounded-full bg-selection px-3 py-1.5 text-[12px] text-content/60" onClick={showEarlier}>
              {t("session.earlier", { count: blocks.length - shown.length })}
            </button>
          ) : null}
          <FileSourceContext.Provider value={fileSource}>
          <div className="flex flex-col gap-3">
            {groupWork(shown).map((item, n, items) =>
              "steps" in item ? (
                // 连着的工具调用合成一段；正在跑的是最后那段
                <div key={item.steps[0].id} className={initial.current?.has(item.steps[0].id) ? "" : "rise-in"}>
                  <WorkGroup steps={item.steps} cwd={cwd} active={busy && n === items.length - 1} />
                </div>
              ) : (
                <Fragment key={item.block.id}>
                  {newDay(shown, item.index) ? <DaySeparator at={item.block.startedAt!} /> : null}
                  <div className={initial.current?.has(item.block.id) ? "" : "rise-in"}>
                    <BlockView block={item.block} copyable={!busy && item.block === lastAssistant} now={busy && item.block === turnUser ? now : undefined} cwd={cwd} />
                  </div>
                </Fragment>
              ),
            )}
            {pending.map((m) => (
              <div key={m.id} className="rise-in">
                <UserBubble text={m.text} state={m.state} onRetry={() => retry(m)} />
              </div>
            ))}
          </div>
          </FileSourceContext.Provider>
        </div>
        <button
          aria-label="scroll to bottom"
          className={`press absolute bottom-3 right-3 grid size-10 place-items-center rounded-full border border-stroke bg-raised text-content/70 shadow-lg transition-all duration-300 ${
            atBottom ? "pointer-events-none translate-y-3 scale-90 opacity-0" : "opacity-100"
          }`}
          onClick={toBottom}
        >
          <Icon name="chevronDown" size={20} />
          {unseen ? <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full border-2 border-raised bg-accent" /> : null}
        </button>
      </div>

      {/* 输入框上面：审批 > 提问 */}
      {approval && sessionId && host?.runId ? (
        <ApprovalDock key={approval.approval!.requestId} block={approval} cwd={session?.worktreeCwd ?? session?.cwd} sessionId={sessionId} runId={host.runId} onDone={() => poll.refresh()} />
      ) : question && sessionId && host?.runId ? (
        <QuestionDock key={question.requestId} questions={question.questions} title={question.title} onAnswer={(reply) => answer(sessionId, host.runId!, question.requestId, reply).then(() => poll.refresh())} />
      ) : null}

      {host?.archived && !busy ? (
        // 电脑拿回去接着聊了（主机上归档）：这里再发会和电脑两边往一个对话里写
        <div className="fade-in flex shrink-0 items-center gap-2 border-t border-stroke px-4 pt-3 text-[13px] text-content/50" style={{ paddingBottom: "calc(var(--safe-bottom) + 14px)" }}>
          <Icon name="computer" size={16} className="shrink-0" />
          <span>{t("session.onDesktop")}</span>
        </div>
      ) : (
      <div className="shrink-0 border-t border-stroke bg-background-base px-3 pt-2" style={{ paddingBottom: "calc(var(--safe-bottom) + 10px)" }}>
        <div className="mb-2 flex items-center gap-2">
          <ModelChip catalog={catalog.data} choice={nextModel ?? current} disabled={!session} onClick={() => sheet.open("model")} />
          {nextModel ? <span className="truncate text-xs text-content/35">{t("session.modelAfterTurn")}</span> : null}
        </div>
        <div className="flex items-end gap-2">
          <AutoTextarea value={text} onChange={(e) => setText(e.target.value)} placeholder={busy ? t("session.queuePlaceholder") : t("session.placeholder")} />
          {/* 和电脑一样：在跑而且没写东西时是停止，写了就是发（排到这一轮后面） */}
          {busy && !text.trim() && host?.runId ? (
            <ActionButton mode="stop" busy={stopping} onClick={halt} />
          ) : (
            <ActionButton mode="send" disabled={!text.trim()} onClick={submit} />
          )}
        </div>
      </div>
      )}

      <ModelSheet
        open={sheet.value === "model"}
        onClose={sheet.close}
        catalog={catalog.data}
        choice={nextModel ?? current}
        lockHarness={session?.harness}
        running={busy}
        onChange={(choice, close) => {
          if (close) void sheet.close();
          if (busy) {
            setNextModel(choice);
            if (close) toast(t("session.modelQueued", { name: modelName(catalog.data, choice.model) }));
          } else if (close || choice.model === current?.model) apply(choice);
        }}
      />
    </div>
  );
}

/** 每秒刷新一次的「现在」，只在要显示计时的时候跑。 */
export function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}
export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** 这一块前面要不要日期分隔：和上一条用户消息不是同一天（第一条不是今天）。 */
export function newDay(blocks: Block[], i: number) {
  const at = blocks[i].role === "user" ? blocks[i].startedAt : undefined;
  if (!at) return false;
  const prev = blocks.slice(0, i).reverse().find((b) => b.role === "user" && b.startedAt)?.startedAt;
  return new Date(prev ?? Date.now()).toDateString() !== new Date(at).toDateString();
}

/** now = 这一轮正在跑（用户消息下面换成流光的「工作中」）。 */
/** actions = 回答下面复制旁边再放的按钮（比如「转成 issue」）。 */
export function BlockView({ block, copyable, now, cwd, actions }: { block: Block; copyable: boolean; now?: number; cwd?: string; actions?: ReactNode }) {
  switch (block.role) {
    case "user":
      return (
        <>
          <UserBubble text={block.text} attachments={block.attachments} at={block.startedAt} />
          {now !== undefined ? (
            <div className="mt-3">
              <WorkingLine block={block} now={now} />
            </div>
          ) : block.durationMs ? (
            <TurnDone block={block} />
          ) : null}
        </>
      );
    case "assistant":
      return (
        <div>
          <Markdown text={block.text} streaming={block.streaming} />
          {copyable || actions ? (
            <div className="-ml-2 mt-0.5 flex items-center gap-1">
              {copyable ? <CopyButton text={block.text} /> : null}
              {actions}
            </div>
          ) : null}
        </div>
      );
    case "reasoning":
      return <Reasoning block={block} />;
    case "tool":
    case "approval":
      return <ToolRow block={block} cwd={cwd} />;
    case "tasks":
      return <TaskList block={block} />;
    case "plan":
      return (
        <div className="rounded-xl border border-stroke bg-raised px-3.5 py-3">
          <div className="mb-1 text-xs text-content/45">{t("session.plan")}</div>
          <Markdown text={block.text} streaming={block.streaming} />
        </div>
      );
    case "image":
      return <ImageBlock block={block} />;
    case "shell":
      return <ShellRow block={block} />;
    default:
      return <SystemRow block={block} />;
  }
}

/** 要允许吗：说明 + 命令或改动预览，拒绝 / 允许。点了先收起来，等主机确认。 */
function ApprovalDock({ block, cwd, sessionId, runId, onDone }: { block: Block; cwd?: string; sessionId: string; runId: string; onDone: () => void }) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const preview = block.tool?.preview;
  const body = preview?.output ?? preview?.lines?.map((l) => (l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  ") + l.text).join("\n") ?? block.tool?.detail;
  const decide = (decision: "allow" | "deny") => {
    haptic(decision === "allow" ? 12 : 8);
    setBusy(decision);
    approve(sessionId, runId, block.approval!.requestId, decision)
      .then(onDone)
      .catch((e: HostError) => {
        toast(e.message);
        setBusy(null);
      });
  };
  return (
    <div className="shrink-0 border-t border-amber/30 bg-amber/[0.06] px-4 pb-3 pt-3" style={{ animation: "rise-in 360ms var(--ease-out-quint) both" }}>
      <div className="mb-1 flex items-center gap-2 text-[12px] text-amber">
        <Icon name="alert" size={14} /> {t("session.approvalTitle")}
      </div>
      <div className="text-[14px] leading-snug text-content/90">{toolLabel(block, cwd)}</div>
      {body ? (
        <pre className="scroll-y mt-2 max-h-36 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-stroke bg-[#111] px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-content/65">{body}</pre>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-selection text-[15px] font-medium" disabled={!!busy} onClick={() => decide("deny")}>
          {busy === "deny" ? <Spinner size={14} /> : null}
          {t("session.deny")}
        </button>
        <button className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-accent-ink" disabled={!!busy} onClick={() => decide("allow")}>
          {busy === "allow" ? <Spinner size={14} /> : null}
          {t("session.allow")}
        </button>
      </div>
    </div>
  );
}

/** agent 问问题：每题选项（单选 / 多选），可以自己写；跳过或提交。 */
function QuestionDock({ questions, title, onAnswer }: { questions: UserQuestion[]; title?: string; onAnswer: (reply: UserQuestionReply) => Promise<unknown> }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const complete = questions.every((q) => picked[q.id]?.length || custom[q.id]?.trim());
  const reply = (skip: boolean) => {
    haptic();
    setBusy(true);
    const answers: Record<string, string[]> = {};
    const own: Record<string, string> = {};
    for (const q of questions) {
      if (picked[q.id]?.length) answers[q.id] = picked[q.id];
      if (custom[q.id]?.trim()) own[q.id] = custom[q.id].trim();
    }
    const value: UserQuestionReply = skip || (!Object.keys(answers).length && !Object.keys(own).length) ? { kind: "skipped" } : { kind: "answered", answers, ...(Object.keys(own).length ? { custom: own } : {}) };
    onAnswer(value).catch((e: HostError) => {
      toast(e.message);
      setBusy(false);
    });
  };
  return (
    <div className="scroll-y max-h-[55%] shrink-0 border-t border-accent/30 bg-accent/[0.05] px-4 pb-3 pt-3" style={{ animation: "rise-in 360ms var(--ease-out-quint) both" }}>
      <div className="mb-2 flex items-center gap-2 text-[12px] text-accent">
        <Icon name="question" size={14} /> {title || t("session.questionTitle")}
      </div>
      {questions.map((q) => (
        <div key={q.id} className="mb-3">
          {q.header ? <div className="text-[11px] uppercase tracking-wide text-content/40">{q.header}</div> : null}
          <div className="mb-2 text-[14px] leading-snug">{q.prompt}</div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((o) => {
              const on = picked[q.id]?.includes(o.id);
              return (
                <button
                  key={o.id}
                  className={`press flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? "border-accent/60 bg-accent/10" : "border-stroke bg-raised"}`}
                  onClick={() => {
                    haptic(4);
                    setPicked((p) => ({ ...p, [q.id]: q.multiSelect ? (on ? p[q.id].filter((x) => x !== o.id) : [...(p[q.id] ?? []), o.id]) : [o.id] }));
                  }}
                >
                  <span className={`mt-0.5 grid size-4 shrink-0 place-items-center border ${q.multiSelect ? "rounded-[4px]" : "rounded-full"} ${on ? "border-accent bg-accent text-accent-ink" : "border-content/30"}`}>
                    {on ? <Icon name="check" size={11} strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px]">{o.label}</span>
                    {o.description ? <span className="mt-0.5 block text-[12px] text-content/45">{o.description}</span> : null}
                  </span>
                </button>
              );
            })}
            {q.allowCustom ? (
              <input
                value={custom[q.id] ?? ""}
                onChange={(e) => setCustom((c) => ({ ...c, [q.id]: e.target.value }))}
                placeholder={t("session.customAnswer")}
                className="h-10 rounded-xl border border-stroke bg-raised px-3 text-[14px] outline-none placeholder:text-content/35 focus:border-content/25"
              />
            ) : null}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button className="press h-11 flex-1 rounded-xl bg-selection text-[15px]" disabled={busy} onClick={() => reply(true)}>
          {t("session.skip")}
        </button>
        <button className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-accent-ink disabled:opacity-40" disabled={busy || !complete} onClick={() => reply(false)}>
          {busy ? <Spinner size={14} /> : null}
          {t("session.submit")}
        </button>
      </div>
    </div>
  );
}
