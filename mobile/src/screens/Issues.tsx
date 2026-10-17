/**
 * 手机上的 issue（SOL-100，原型 v1 A）：首页的 Issues 栏、issue 详情，以及改状态 / 优先级、开工、通过、打回、新建（转成 issue）这几个弹层。
 * 数据经网关请电脑做（host/issues.ts），电脑不在线时看不了。
 */
import { useEffect, useState } from "react";
import { usePoll } from "../host/poll";
import { listModels } from "../host/host";
import type { HostError } from "../host/rpc";
import {
  PRIORITIES,
  STATUSES,
  acceptIssue,
  createIssue,
  getIssue,
  linkIssue,
  priorityLabel,
  projectIssues,
  sendBack,
  startPrompt,
  startWork,
  statusLabel,
  updateIssue,
  type IssueBrief,
  type IssueDetail,
  type IssueRow,
  type IssueStatus,
  type ProjectIssues,
} from "../host/issues";
import { t, useTranslation } from "../i18n";
import { lastModel, type ModelChoice } from "../prefs";
import { Icon } from "../ui/icons";
import { AutoTextarea } from "../ui/inputs";
import { Sheet, Spinner, haptic, toast, useSheet } from "../ui/kit";
import { useActive, useNav, type Route } from "../ui/nav";
import { Check, ChevronDown, ChevronRight } from "../../../src/shared/ui/icons";
import { formatRelative } from "../ui/desktop";
import { Markdown, cleanTitle } from "./blocks";
import { ModelChip, ModelSheet, defaultChoice } from "./ModelSheet";

// ---------- 图标（照抄电脑 IssueIcons.tsx） ----------
const STATUS_TONE: Record<IssueStatus, string> = {
  backlog: "text-content/40",
  todo: "text-content/60",
  in_progress: "text-amber-400",
  in_review: "text-sky-400",
  done: "text-accent",
  canceled: "text-content/40",
};

/** 状态永远是「形状 + 名字」，颜色只是辅助。 */

/** 网关的英文原因换成给人看的：电脑不在线 / 电脑上没有这个项目（只在主机上开过的文件夹）。 */
const issueError = (e: { message: string }) =>
  /No computer has this project/i.test(e.message) ? t("issues.noProject") : /offline/i.test(e.message) ? t("issues.offline") : e.message;
export function StatusIcon({ status, className = "" }: { status: IssueStatus; className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={`size-3.5 shrink-0 ${STATUS_TONE[status]} ${className}`} role="img" aria-label={statusLabel(status)}>
      {status === "backlog" && <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />}
      {status === "todo" && <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {status === "in_progress" && (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      )}
      {status === "in_review" && (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="3" fill="currentColor" />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--color-background-base)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "canceled" && (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M5 5l4 4M9 5l-4 4" stroke="var(--color-background-base)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const PRIORITY_TONE: Record<number, string> = { 2: "text-orange-400", 3: "text-yellow-400", 4: "text-blue-400" };

export function PriorityIcon({ priority }: { priority: number }) {
  const label = priorityLabel(priority);
  if (priority === 1)
    return (
      <span role="img" aria-label={label} className="grid size-3.5 shrink-0 place-items-center rounded-[3px] bg-red-400 text-[10px] font-bold leading-none text-black">
        !
      </span>
    );
  return (
    <svg viewBox="0 0 14 14" className={`size-3.5 shrink-0 ${PRIORITY_TONE[priority] ?? "text-content/60"}`} role="img" aria-label={label}>
      {priority === 0 ? (
        <path d="M3 7h1.5M6.25 7h1.5M9.5 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        [0, 1, 2].map((i) => <rect key={i} x={2.5 + i * 3.5} y={10 - (i + 1) * 2.5} width="2.5" height={(i + 1) * 2.5 + 1} rx="0.5" fill="currentColor" opacity={i < 5 - priority ? 1 : 0.3} />)
      )}
    </svg>
  );
}

/** 首页和会话页共用一份：同一个 key，谁先拿到大家都有。 */
export const useProjectIssues = (cwd: string | undefined, active: boolean) =>
  usePoll<ProjectIssues>(cwd ? `issues:${cwd}` : null, () => projectIssues(cwd!), () => 15_000, active);

// ---------- 首页 Issues 栏 ----------
const GROUPS: IssueStatus[] = ["in_review", "in_progress", "todo", "backlog", "done"];

/** 会话的状态：在等你 / 在跑（首页会话列表那份传进来）。 */
export type SessionState = Record<string, "input" | "running" | undefined>;

export function IssuesTab({
  data,
  error,
  sessions,
  onOpen,
}: {
  data: ProjectIssues | undefined;
  error?: HostError;
  sessions: SessionState;
  onOpen: (issue: IssueBrief) => void;
}) {
  useTranslation();
  const [all, setAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  if (error && !data) return <div className="px-6 py-16 text-center text-[14px] text-content/50">{issueError(error)}</div>;
  if (data === undefined)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={18} />
      </div>
    );
  if (data === null) return <div className="px-6 py-16 text-center text-[14px] text-content/50">{t("issues.noProject")}</div>;
  const current = data.issues.filter((i) => i.current);
  const list = all || !data.iteration ? data.issues : current;
  const percent = data.iteration && data.iteration.total ? (data.iteration.done / data.iteration.total) * 100 : 0;
  return (
    <div className="pb-4">
      <div className="mx-4 mt-3 rounded-2xl border border-stroke bg-raised px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{data.iteration ? `${data.iteration.tag} ${data.iteration.name}` : t("issues.noIteration")}</span>
          {data.iteration ? (
            <button
              className="press flex h-8 shrink-0 items-center gap-1 rounded-md bg-selection px-2.5 text-[12px] text-content/70"
              onClick={() => {
                haptic();
                setAll((v) => !v);
              }}
            >
              {all ? t("issues.all") : t("issues.current")}
              <ChevronDown className="size-3 text-content/50" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        {data.iteration ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-content/10">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-content/40">
              {data.iteration.done}/{data.iteration.total}
            </span>
          </div>
        ) : null}
      </div>
      {!list.length ? <div className="px-6 py-10 text-center text-[13px] text-content/45">{t("issues.empty")}</div> : null}
      {GROUPS.map((group) => {
        const rows = list.filter((i) => i.status === group);
        if (!rows.length) return null;
        if (group === "done")
          return (
            <section key={group}>
              <button className="press flex w-full items-center justify-between px-4 pb-1.5 pt-4 text-xs text-content/40" onClick={() => setShowDone((v) => !v)}>
                <span>{t("issues.showDone", { count: rows.length })}</span>
                {showDone ? <ChevronDown className="size-3.5" strokeWidth={1.75} /> : <ChevronRight className="size-3.5" strokeWidth={1.75} />}
              </button>
              {showDone ? rows.map((i) => <IssueListRow key={i.id} issue={i} sessions={sessions} onOpen={onOpen} />) : null}
            </section>
          );
        return (
          <section key={group}>
            <div className="flex items-center justify-between px-4 pb-1.5 pt-4 text-xs text-content/40">
              <span>{statusLabel(group)}</span>
              <span>{rows.length}</span>
            </div>
            {rows.map((i) => (
              <IssueListRow key={i.id} issue={i} sessions={sessions} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function IssueListRow({ issue, sessions, onOpen }: { issue: IssueRow; sessions: SessionState; onOpen: (issue: IssueBrief) => void }) {
  const states = issue.sessions.map((id) => sessions[id]);
  return (
    <button className="press-row flex w-full min-w-0 items-center gap-2.5 px-4 py-3 text-left" onClick={() => onOpen(issue)}>
      <StatusIcon status={issue.status} />
      <span className="shrink-0 font-mono text-[12px] text-content/45">{issue.ident}</span>
      <span className="min-w-0 flex-1 truncate text-[15px]">{issue.title}</span>
      {states.includes("input") ? (
        <span className="shrink-0 rounded-full bg-amber/15 px-2 py-0.5 text-[11px] text-amber">{t("issues.waiting")}</span>
      ) : states.includes("running") ? (
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
      ) : null}
      <PriorityIcon priority={issue.priority} />
    </button>
  );
}

/** Issues 栏底部的一行新建：回车建进当前迭代。 */
export function QuickIssue({ cwd, data, onCreated }: { cwd: string; data: ProjectIssues | undefined; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const submit = () => {
    const value = title.trim();
    if (!value || busy) return;
    haptic();
    setBusy(true);
    createIssue(cwd, data.project.id, value).then(
      () => {
        setTitle("");
        setBusy(false);
        toast(t("issues.created"));
        onCreated();
      },
      (e: HostError) => {
        setBusy(false);
        toast(e.message);
      },
    );
  };
  return (
    <div className="shrink-0 border-t border-stroke bg-background-base px-3 pt-2" style={{ paddingBottom: "calc(var(--safe-bottom) + 10px)" }}>
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          enterKeyHint="done"
          placeholder={data.iteration ? t("issues.quickPlaceholder", { iteration: data.iteration.tag }) : t("issues.quickPlaceholderPlain")}
          className="h-12 min-w-0 flex-1 rounded-[22px] border border-stroke bg-raised px-4 text-[15px] outline-none placeholder:text-content/35"
        />
        <button
          aria-label={t("issues.newIssue")}
          disabled={!title.trim() || busy}
          className={`press grid size-12 shrink-0 place-items-center rounded-[12px] ${title.trim() ? "bg-accent text-white" : "bg-content/10 text-content/40"}`}
          onClick={submit}
        >
          {busy ? <Spinner size={16} /> : <Icon name="add" size={20} />}
        </button>
      </div>
    </div>
  );
}

// ---------- issue 详情 ----------
type IssueSheet = "status" | "priority" | "start" | "model" | "accept" | "sendBack";

export function IssueScreen({ route }: { route: Extract<Route, { name: "issue" }> }) {
  useTranslation();
  const active = useActive();
  const nav = useNav();
  const detail = usePoll<IssueDetail | null>(`issue:${route.cwd}:${route.id}`, () => getIssue(route.cwd, route.id), () => 10_000, active);
  const project = useProjectIssues(route.cwd, active);
  const catalog = usePoll(`models:${route.projectId}`, () => listModels(route.projectId), () => 300_000, active);
  const sheet = useSheet<IssueSheet>();
  const issue = detail.data;
  const refresh = () => Promise.all([detail.refresh(), project.refresh()]);
  const [prompt, setPrompt] = useState<string>();
  const [choice, setChoice] = useState<ModelChoice | null>(lastModel.get());
  const model = defaultChoice(catalog.data, choice) ?? choice;
  const sessions = issue?.sessions.filter((s) => !s.missing) ?? [];

  const change = (patch: { status?: IssueStatus; priority?: number }) => {
    if (!issue) return;
    haptic();
    void sheet.close();
    updateIssue(route.cwd, issue.id, patch).then(refresh, (e: HostError) => toast(e.message));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-stroke pb-1.5 pl-1 pr-3" style={{ paddingTop: "calc(var(--safe-top) + 6px)" }}>
        <button aria-label="back" className="press grid size-11 shrink-0 place-items-center rounded-full text-content/70 active:bg-selection" onClick={nav.back}>
          <Icon name="back" size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[16px] font-semibold">{route.ident}</div>
          <div className="truncate text-xs text-content/45">
            {project.data?.project.name ?? ""}
            {project.data?.iteration && project.data.issues.find((i) => i.id === route.id)?.current ? ` · ${project.data.iteration.tag} ${project.data.iteration.name}` : ""}
          </div>
        </div>
      </header>

      <div className="scroll-y min-h-0 flex-1 pb-6">
        {issue === undefined ? (
          detail.error ? (
            <div className="px-6 py-16 text-center text-[14px] text-content/50">{issueError(detail.error)}</div>
          ) : (
            <div className="flex justify-center py-16">
              <Spinner size={18} />
            </div>
          )
        ) : issue === null ? (
          <div className="px-6 py-16 text-center text-[14px] text-content/50">{t("issues.deleted")}</div>
        ) : (
          <>
            <h1 className="px-4 pt-4 text-[20px] font-semibold leading-snug">{issue.title}</h1>
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              <button className="press flex h-9 items-center gap-1.5 rounded-lg bg-selection px-3 text-[13px]" onClick={() => sheet.open("status")}>
                <StatusIcon status={issue.status} />
                {statusLabel(issue.status)}
              </button>
              <button className="press flex h-9 items-center gap-1.5 rounded-lg bg-selection px-3 text-[13px]" onClick={() => sheet.open("priority")}>
                <PriorityIcon priority={issue.priority} />
                {priorityLabel(issue.priority)}
              </button>
              {issue.repo_path ? <span className="flex h-9 items-center rounded-lg bg-selection px-3 font-mono text-[12px] text-content/60">{issue.repo_path.split("/").pop()}</span> : null}
            </div>
            {issue.body_md.trim() ? (
              <div className="px-4 pt-4">
                <Markdown text={issue.body_md} />
              </div>
            ) : null}
            {issue.acceptance.length ? (
              <>
                <div className="px-4 pb-1.5 pt-5 text-xs text-content/40">{t("issues.acceptance")}</div>
                <ul className="space-y-2 px-4">
                  {issue.acceptance.map((a) => (
                    <li key={a.id} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-content/80">
                      {a.done ? <Check className="mt-1 size-3.5 shrink-0 text-accent" strokeWidth={2} /> : <span className="mt-1.5 size-3 shrink-0 rounded-[3px] border border-content/30" />}
                      <span>{a.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className="flex items-center justify-between px-4 pb-1.5 pt-5 text-xs text-content/40">
              <span>{t("issues.sessions")}</span>
              {sessions.length ? <span>{sessions.length}</span> : null}
            </div>
            {sessions.length ? (
              sessions.map((s) => (
                <button
                  key={s.id}
                  className="press-row flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left"
                  onClick={() => nav.push({ name: "mirror", id: s.id, projectId: route.projectId, title: cleanTitle(s.title ?? "") })}
                >
                  <Icon name="computer" size={15} className="shrink-0 text-content/45" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{cleanTitle(s.title ?? "") || s.id}</span>
                  {s.updated_at ? <span className="shrink-0 text-xs text-content/40">{formatRelative(s.updated_at)}</span> : null}
                </button>
              ))
            ) : (
              <div className="px-4 text-[13px] text-content/45">{t("issues.noSessions")}</div>
            )}
            {issue.comments.length ? (
              <>
                <div className="px-4 pb-1.5 pt-5 text-xs text-content/40">{t("issues.comments")}</div>
                <div className="space-y-3 px-4">
                  {issue.comments.map((c) => {
                    const agent = c.actor !== "user";
                    return (
                      <div key={c.id} className="flex gap-2.5">
                        <div className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${agent ? "bg-accent/15 text-accent" : "bg-selection text-content/70"}`}>
                          {agent ? "AI" : t("issues.me")}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-content/40">
                            {agent ? t("issues.agent") : t("issues.me")} · {formatRelative(Date.parse(c.created_at))}
                          </div>
                          <Markdown text={c.body_md} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      {issue ? (
        <div className="flex shrink-0 gap-2 border-t border-stroke px-3 pt-2" style={{ paddingBottom: "calc(var(--safe-bottom) + 10px)" }}>
          {issue.status === "in_review" ? (
            <>
              <BarButton label={t("issues.sendBack")} onClick={() => sheet.open("sendBack")} />
              <BarButton primary label={t("issues.accept")} onClick={() => sheet.open("accept")} />
            </>
          ) : issue.status === "in_progress" && sessions.length ? (
            <BarButton label={t("issues.openSession")} onClick={() => nav.push({ name: "mirror", id: sessions[0].id, projectId: route.projectId, title: sessions[0].title })} />
          ) : issue.status === "todo" || issue.status === "backlog" || issue.status === "in_progress" ? (
            <BarButton
              primary
              label={t("issues.start")}
              onClick={() => {
                setPrompt((p) => p ?? startPrompt(issue, project.data?.project.name ?? route.cwd.split("/").pop() ?? "", route.cwd));
                sheet.open("start");
              }}
            />
          ) : null}
        </div>
      ) : null}

      {issue ? (
        <>
          <Sheet open={sheet.value === "status"} onClose={sheet.close} title={t("issues.changeStatus", { ident: issue.ident })}>
            {STATUSES.map((s) => (
              <Option key={s} selected={issue.status === s} onClick={() => change({ status: s })}>
                <StatusIcon status={s} />
                {statusLabel(s)}
              </Option>
            ))}
          </Sheet>
          <Sheet open={sheet.value === "priority"} onClose={sheet.close} title={t("issues.changePriority", { ident: issue.ident })}>
            {PRIORITIES.map((p) => (
              <Option key={p} selected={issue.priority === p} onClick={() => change({ priority: p })}>
                <PriorityIcon priority={p} />
                {priorityLabel(p)}
              </Option>
            ))}
          </Sheet>
          <StartSheet
            open={sheet.value === "start"}
            onClose={sheet.close}
            issue={issue}
            prompt={prompt ?? ""}
            onPrompt={setPrompt}
            catalog={catalog.data}
            model={model}
            onModel={() => void sheet.close().then(() => sheet.open("model"))}
            onStart={() =>
              startWork(route.cwd, issue, prompt ?? "", model ? { harness: model.harness, model: model.model, settings: model.settings } : undefined).then(
                () => {
                  toast(t("issues.started"));
                  void sheet.close();
                  setPrompt(undefined);
                  setTimeout(() => void refresh(), 4000);
                },
                (e: HostError) => toast(issueError(e)),
              )
            }
          />
          <ModelSheet
            open={sheet.value === "model"}
            onClose={() => void sheet.close().then(() => sheet.open("start"))}
            catalog={catalog.data}
            choice={model}
            onChange={(next, close) => {
              setChoice(next);
              lastModel.set(next);
              if (close) void sheet.close().then(() => sheet.open("start"));
            }}
          />
          <AcceptSheet
            open={sheet.value === "accept"}
            onClose={sheet.close}
            issue={issue}
            onAccept={() =>
              acceptIssue(route.cwd, issue.id).then((error) => {
                if (error) return error;
                toast(t("issues.accepted"));
                void sheet.close();
                void refresh();
                return null;
              })
            }
          />
          <SendBackSheet
            open={sheet.value === "sendBack"}
            onClose={sheet.close}
            issue={issue}
            session={sessions[0]?.title}
            onSend={(reason) =>
              sendBack(route.cwd, issue, reason).then(() => {
                toast(t("issues.sentBack"));
                void sheet.close();
                void refresh();
              })
            }
          />
        </>
      ) : null}
    </div>
  );
}

function BarButton({ label, primary, onClick }: { label: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      className={`press h-12 flex-1 rounded-xl text-[15px] font-medium ${primary ? "bg-accent text-white" : "bg-selection text-content"}`}
      onClick={() => {
        haptic();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`press-row flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left text-[15px] ${selected ? "bg-selection" : ""}`} onClick={onClick}>
      <span className="flex min-w-0 flex-1 items-center gap-2.5">{children}</span>
      {selected ? <Check className="size-4 shrink-0 text-content/55" strokeWidth={2} /> : null}
    </button>
  );
}

function SheetButtons({ confirm, busy, disabled, onCancel, onConfirm }: { confirm: string; busy?: boolean; disabled?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="flex gap-2 px-1 pt-3">
      <button className="press h-12 flex-1 rounded-xl bg-selection text-[15px]" onClick={onCancel}>
        {t("issues.cancel")}
      </button>
      <button
        disabled={busy || disabled}
        className={`press flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-medium ${disabled ? "bg-content/10 text-content/40" : "bg-accent text-white"}`}
        onClick={onConfirm}
      >
        {busy ? <Spinner size={14} /> : null}
        {confirm}
      </button>
    </div>
  );
}

/** 在跑的那段异步：按钮转圈，结束收回来。 */
function useBusy() {
  const [busy, setBusy] = useState(false);
  return [busy, (run: () => Promise<unknown>) => {
    setBusy(true);
    void run().finally(() => setBusy(false));
  }] as const;
}

function StartSheet({
  open,
  onClose,
  issue,
  prompt,
  onPrompt,
  catalog,
  model,
  onModel,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  issue: IssueDetail;
  prompt: string;
  onPrompt: (value: string) => void;
  catalog: Parameters<typeof ModelChip>[0]["catalog"];
  model: ModelChoice | null;
  onModel: () => void;
  onStart: () => Promise<unknown>;
}) {
  const [busy, run] = useBusy();
  return (
    <Sheet open={open} onClose={onClose} title={t("issues.startTitle", { ident: issue.ident })}>
      <div className="px-1">
        <p className="pb-2 text-[13px] text-content/50">{issue.repo_path ? t("issues.startHintRepo", { repo: issue.repo_path.split("/").pop() }) : t("issues.startHint")}</p>
        <div className="pb-2">
          <ModelChip catalog={catalog} choice={model} onClick={onModel} />
        </div>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          rows={8}
          className="w-full resize-none rounded-xl border border-stroke bg-background-base px-3 py-2.5 text-[14px] leading-relaxed outline-none"
        />
        <SheetButtons confirm={t("issues.begin")} busy={busy} disabled={!prompt.trim()} onCancel={onClose} onConfirm={() => run(onStart)} />
      </div>
    </Sheet>
  );
}

function AcceptSheet({ open, onClose, issue, onAccept }: { open: boolean; onClose: () => void; issue: IssueDetail; onAccept: () => Promise<string | null> }) {
  const [busy, run] = useBusy();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={t("issues.acceptTitle", { ident: issue.ident })}>
      <div className="px-1">
        <p className="text-[14px] leading-relaxed text-content/60">{t("issues.acceptHint")}</p>
        {error ? <p className="mt-3 rounded-xl bg-red/10 px-3 py-2.5 text-[13px] leading-relaxed text-red">{error}</p> : null}
        <SheetButtons confirm={t("merge.accept")} busy={busy} onCancel={onClose} onConfirm={() => run(() => onAccept().then(setError, (e: HostError) => setError(e.message)))} />
      </div>
    </Sheet>
  );
}

function SendBackSheet({ open, onClose, issue, session, onSend }: { open: boolean; onClose: () => void; issue: IssueDetail; session?: string; onSend: (reason: string) => Promise<unknown> }) {
  const [busy, run] = useBusy();
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title={t("issues.sendBackTitle", { ident: issue.ident })}>
      <div className="px-1">
        <div className="flex">
          <AutoTextarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("issues.sendBackPlaceholder")} />
        </div>
        <p className="pt-2 text-[12px] text-content/45">{session ? t("issues.sendBackHint", { title: cleanTitle(session) }) : t("issues.sendBackHintPlain")}</p>
        <SheetButtons
          confirm={t("issues.sendBack")}
          busy={busy}
          disabled={!reason.trim()}
          onCancel={onClose}
          onConfirm={() =>
            run(() =>
              onSend(reason.trim()).then(
                () => setReason(""),
                (e: HostError) => toast(e.message),
              ),
            )
          }
        />
      </div>
    </Sheet>
  );
}

/** 新 issue / 转成 issue：标题、优先级，排进当前迭代；从会话转的挂上这个会话。 */
export function NewIssueSheet({
  open,
  onClose,
  cwd,
  data,
  title: initial,
  sessionId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  cwd: string;
  data: ProjectIssues | undefined;
  title?: string;
  sessionId?: string;
  onCreated: () => void;
}) {
  const [busy, run] = useBusy();
  const [title, setTitle] = useState(initial ?? "");
  const [priority, setPriority] = useState<number>(3);
  useEffect(() => {
    if (open) setTitle(initial ?? "");
  }, [open, initial]);
  if (!data) return null;
  const hint =
    (data.iteration ? t("issues.createHint", { project: data.project.name, iteration: data.iteration.tag }) : t("issues.createHintPlain", { project: data.project.name })) +
    (sessionId ? t("issues.createHintLink") : "");
  return (
    <Sheet open={open} onClose={onClose} title={sessionId ? t("issues.toIssue") : t("issues.newIssue")}>
      <div className="px-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("issues.titlePlaceholder")}
          className="h-12 w-full rounded-xl border border-stroke bg-background-base px-3 text-[15px] outline-none"
        />
        <div className="flex flex-wrap gap-2 pt-3">
          {[1, 2, 3, 4].map((p) => (
            <button key={p} className={`press flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] ${priority === p ? "bg-accent/20 text-content" : "bg-selection text-content/70"}`} onClick={() => setPriority(p)}>
              <PriorityIcon priority={p} />
              {priorityLabel(p)}
            </button>
          ))}
        </div>
        <p className="pt-3 text-[12px] text-content/45">{hint}</p>
        <SheetButtons
          confirm={t("issues.create")}
          busy={busy}
          disabled={!title.trim()}
          onCancel={onClose}
          onConfirm={() =>
            run(async () => {
              try {
                const id = await createIssue(cwd, data.project.id, title.trim(), priority);
                if (sessionId) await linkIssue(cwd, sessionId, id);
                toast(t("issues.created"));
                onCreated();
                void onClose();
              } catch (e) {
                toast((e as HostError).message);
              }
            })
          }
        />
      </div>
    </Sheet>
  );
}

/** 会话页顶上：这个会话挂的 issue（编号 · 标题 · 状态 ›），点了进 issue。 */
export function IssueStrip({ issue, onOpen }: { issue: IssueBrief; onOpen: () => void }) {
  return (
    <button className="press-row flex w-full shrink-0 items-center gap-2 border-b border-stroke px-4 py-2.5 text-left" onClick={onOpen}>
      <StatusIcon status={issue.status} />
      <span className="shrink-0 font-mono text-[12px] text-content/50">{issue.ident}</span>
      <span className="min-w-0 flex-1 truncate text-[14px]">{issue.title}</span>
      <span className="shrink-0 text-xs text-content/40">{statusLabel(issue.status)}</span>
      <ChevronRight className="size-3.5 shrink-0 text-content/35" strokeWidth={1.75} />
    </button>
  );
}
