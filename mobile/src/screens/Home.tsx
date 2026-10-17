/** 首页：顶上切项目，中间按「等你处理 / 运行中 / 刚跑完 / 最近」列会话，底下直接问。 */
import { useEffect, useMemo, useState } from "react";
import { browse, listMirror, listModels, listProjects, listSessions, openProject, type HostDirectory, type HostProject, type HostSessionSummary, type MirrorSummary, type RemoteProvider } from "../host/host";
import { usePoll } from "../host/poll";
import { useApp } from "../app-context";
import { appVersion, t, useTranslation } from "../i18n";
import { installedAt, lastModel, lastProject, seenAt, type ModelChoice } from "../prefs";
import { Icon } from "../ui/icons";
import { ActionButton, AutoTextarea, PullScroll } from "../ui/inputs";
import { Dot, Empty, Sheet, Spinner, haptic, toast, useSheet } from "../ui/kit";
import { useActive, useNav } from "../ui/nav";
import { HARNESS_NAME, ModelChip, ModelSheet, defaultChoice, modelName } from "./ModelSheet";
import type { HarnessId } from "../../../src/features/sessions/model/session";
import { Check, CircleAlert, GitBranch } from "../../../src/shared/ui/icons";
import { HarnessIcon, ProjectMascot, TerminalSpinner, formatRelative, projectColor } from "../ui/desktop";
import { cleanTitle } from "./blocks";
import { IssuesTab, QuickIssue, StatusIcon, useProjectIssues, type SessionState } from "./Issues";
import type { IssueBrief } from "../host/issues";

type Section = "input" | "running" | "fresh" | "recent";
const SECTIONS: Section[] = ["input", "running", "fresh", "recent"];

function sectionOf(s: HostSessionSummary): Section {
  if (s.needsInput) return "input";
  if (s.status === "running") return "running";
  if (s.updatedAt > Math.max(seenAt(s.id), installedAt)) return "fresh";
  return "recent";
}

export const shortPath = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, "~");

export function HomeScreen() {
  useTranslation();
  const active = useActive();
  const nav = useNav();
  const { connection, online } = useApp();
  const projects = usePoll("projects", listProjects, () => 15_000, active);
  const [projectId, setProjectId] = useState(lastProject.get());
  const project = projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0];
  useEffect(() => {
    if (project) lastProject.set(project.id);
  }, [project?.id]);

  const sessions = usePoll(
    project ? `sessions:${project.id}` : null,
    () => listSessions(project!.id),
    (list) => (list?.some((s) => s.status === "running") ? 2000 : 4000),
    active,
  );
  const catalog = usePoll(project ? `models:${project.id}` : null, () => listModels(project!.id), () => 300_000, active);
  // 电脑上的会话（经网关）；没有网关时这里一直是空的
  const mirror = usePoll(project ? `mirror:${project.id}` : null, () => listMirror(project!.cwd), () => 10_000, active);
  const [mirrorAll, setMirrorAll] = useState<Record<string, boolean>>({});
  // 按电脑分组：开着 Soloyard 的（能发消息）排前面，同样的按最近动过的排。已经在主机上接着聊的不重复列
  const desktop = useMemo(() => {
    const onHost = new Set((sessions.data ?? []).map((s) => s.id));
    const groups = new Map<string, MirrorSummary[]>();
    for (const m of mirror.data ?? []) {
      if (m.continuedAs && onHost.has(m.continuedAs)) continue;
      groups.set(m.machine, [...(groups.get(m.machine) ?? []), m]);
    }
    return [...groups.entries()]
      .map(([machine, items]) => ({ machine, items, online: items.some((m) => m.online) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || b.items[0].updatedAt - a.items[0].updatedAt);
  }, [mirror.data, sessions.data]);
  // 原型 v1 A：项目里分「会话 / Issues」两栏（SOL-100）；issue 数据经网关问电脑
  const [tab, setTab] = useState<"sessions" | "issues">("sessions");
  const issues = useProjectIssues(project?.cwd, active);
  const sessionIssues = issues.data?.sessionIssues ?? {};
  const sessionState = useMemo(() => {
    const out: SessionState = {};
    for (const s of sessions.data ?? []) out[s.id] = s.needsInput ? "input" : s.status === "running" ? "running" : undefined;
    for (const m of mirror.data ?? []) if (m.busy) out[m.id] = "running";
    return out;
  }, [sessions.data, mirror.data]);
  const [choice, setChoice] = useState<ModelChoice | null>(lastModel.get());
  const effective = defaultChoice(catalog.data, choice) ?? choice;

  const sheet = useSheet<"project" | "model" | "folder">();
  const [text, setText] = useState("");

  const grouped = useMemo(() => {
    const out: Record<Section, HostSessionSummary[]> = { input: [], running: [], fresh: [], recent: [] };
    for (const s of sessions.data ?? []) if (!s.archived && !s.draft) out[sectionOf(s)].push(s);
    for (const list of Object.values(out)) list.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }, [sessions.data]);
  const empty = sessions.data && !SECTIONS.some((k) => grouped[k].length) && !desktop.length;

  const ask = () => {
    const value = text.trim();
    if (!value || !project || !effective) return;
    haptic();
    setText("");
    nav.push({
      name: "session",
      projectId: project.id,
      title: value.slice(0, 40),
      start: { text: value, commandId: crypto.randomUUID(), draft: { harness: effective.harness as RemoteProvider, model: effective.model, settings: effective.settings, mode: "supervised" } },
    });
  };

  let row = 0;
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-stroke px-2 pb-1.5" style={{ paddingTop: "calc(var(--safe-top) + 6px)" }}>
        <button className="press flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 text-left active:bg-selection" onClick={() => sheet.open("project")}>
          <ProjectMark name={project?.name ?? "?"} />
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[17px] font-semibold">
              <span className="truncate">{project?.name ?? t("home.noProject")}</span>
              <Icon name="chevronDown" size={16} className="shrink-0 text-content/40" />
            </div>
            <div className="flex items-center gap-1.5 truncate text-xs text-content/45">
              <Dot tone={online ? "fresh" : "error"} className="!size-1.5" />
              <span className="truncate">
                {online ? connection.name : t("home.offline")}
                {issues.data?.iteration ? ` · ${issues.data.iteration.tag} ${issues.data.iteration.name}` : ""}
              </span>
            </div>
          </div>
        </button>
      </header>
      {project ? <Tabs tab={tab} onTab={setTab} sessions={grouped.input.length + grouped.fresh.length} issues={issues.data ?? undefined} /> : null}

      {project && tab === "issues" ? (
        <PullScroll onRefresh={() => issues.refresh()}>
          <IssuesTab
            data={issues.data}
            error={issues.error}
            sessions={sessionState}
            onOpen={(issue) => nav.push({ name: "issue", cwd: project.cwd, id: issue.id, ident: issue.ident, projectId: project.id })}
          />
        </PullScroll>
      ) : (
      <PullScroll onRefresh={() => Promise.all([projects.refresh(), sessions.refresh()])}>
        {!projects.data ? (
          <Skeleton />
        ) : !project ? (
          <Empty
            icon="folderOpen"
            title={t("home.noProjectsTitle")}
            hint={t("home.noProjectsHint")}
            action={
              <button className="press h-10 rounded-full bg-accent px-5 text-[14px] font-medium text-accent-ink" onClick={() => sheet.open("folder")}>
                {t("projects.openFolder")}
              </button>
            }
          />
        ) : !sessions.data ? (
          <Skeleton />
        ) : empty ? (
          <>
            <Empty icon="search" title={t("home.noSessionsTitle")} hint={t("home.noSessionsHint")} />
            {mirror.error?.kind === "host" ? <NoGateway /> : null}
          </>
        ) : (
          <div className="pb-4">
            {SECTIONS.map((section) =>
              grouped[section].length ? (
                <section key={section}>
                  <div className="flex items-center justify-between px-4 pb-1.5 pt-4 text-xs text-content/40">
                    <span>{t(`home.section.${section}`)}</span>
                    {section !== "recent" ? <span>{grouped[section].length}</span> : null}
                  </div>
                  {grouped[section].map((s) => (
                    <SessionRow key={s.id} session={s} section={section} index={row++} catalog={catalog.data} issue={sessionIssues[s.id]} onOpen={() => nav.push({ name: "session", projectId: s.projectId, sessionId: s.id, title: s.title })} />
                  ))}
                </section>
              ) : null,
            )}
            {mirror.error?.kind === "host" ? <NoGateway /> : null}
            {desktop.map((group) => (
              <section key={group.machine} className={group.online ? "" : "opacity-70"}>
                <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-4 text-xs text-content/40">
                  <span className="truncate">{t("home.section.desktop", { machine: group.machine })}</span>
                  <span className={`size-1.5 shrink-0 rounded-full ${group.online ? "bg-green" : "bg-content/25"}`} />
                  <span className={`shrink-0 ${group.online ? "text-green/80" : ""}`}>{group.online ? t("home.machineOnline") : t("home.machineOffline")}</span>
                  <span className="ml-auto shrink-0">{group.items.length}</span>
                </div>
                {(mirrorAll[group.machine] ? group.items : group.items.slice(0, 15)).map((m) => (
                  <MirrorRow key={m.id} item={m} index={row++} catalog={catalog.data} issue={sessionIssues[m.id]} onOpen={() => nav.push({ name: "mirror", id: m.id, projectId: project!.id, title: m.title, machine: m.machine })} />
                ))}
                {!mirrorAll[group.machine] && group.items.length > 15 ? (
                  <button
                    className="press mx-4 mt-1 h-9 rounded-full bg-selection px-4 text-[13px] text-content/60"
                    onClick={() => setMirrorAll((all) => ({ ...all, [group.machine]: true }))}
                  >
                    {t("home.showMore", { count: group.items.length - 15 })}
                  </button>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </PullScroll>
      )}

      {project && tab === "issues" ? (
        <QuickIssue cwd={project.cwd} data={issues.data ?? undefined} onCreated={() => void issues.refresh()} />
      ) : project ? (
        <div className="shrink-0 border-t border-stroke bg-background-base px-3 pt-2" style={{ paddingBottom: "calc(var(--safe-bottom) + 10px)" }}>
          <div className="mb-2 flex items-center gap-2">
            <ModelChip catalog={catalog.data} choice={effective} onClick={() => sheet.open("model")} />
            <span className="truncate text-xs text-content/35">{t("home.newSession")}</span>
          </div>
          <div className="flex items-end gap-2">
            <AutoTextarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t("home.askPlaceholder", { project: project.name })} enterKeyHint="send" />
            <ActionButton mode="send" disabled={!text.trim() || !effective} onClick={ask} />
          </div>
        </div>
      ) : null}

      <ProjectSheet
        open={sheet.value === "project"}
        onClose={sheet.close}
        projects={projects.data ?? []}
        current={project?.id}
        onChoose={(id) => {
          haptic();
          setProjectId(id);
          void sheet.close();
        }}
        onOpenFolder={() => void sheet.close().then(() => sheet.open("folder"))}
      />
      <FolderSheet
        open={sheet.value === "folder"}
        onClose={sheet.close}
        onOpened={(opened) => {
          setProjectId(opened.id);
          void projects.refresh();
          void sheet.close();
          toast(t("projects.opened", { name: opened.name }));
        }}
      />
      <ModelSheet
        open={sheet.value === "model"}
        onClose={sheet.close}
        catalog={catalog.data}
        choice={effective}
        onChange={(next, close) => {
          setChoice(next);
          lastModel.set(next);
          if (close) void sheet.close();
        }}
      />
    </div>
  );
}

function SessionRow({ session: s, section, index, catalog, issue, onOpen }: { session: HostSessionSummary; section: Section; index: number; catalog?: Parameters<typeof modelName>[0]; issue?: IssueBrief; onOpen: () => void }) {
  const status: CardStatus = s.status === "interrupted" ? "interrupted" : section === "input" ? "input" : section === "running" ? "working" : section === "fresh" ? "done" : "idle";
  return (
    <SessionCard
      index={index}
      harness={s.harness}
      model={s.model ? modelName(catalog, s.model) : HARNESS_NAME[s.harness] ?? s.harness}
      title={cleanTitle(s.title) || t("session.untitled")}
      branch={s.branch}
      status={status}
      updatedAt={s.updatedAt}
      issue={issue}
      onOpen={onOpen}
    />
  );
}

type CardStatus = "input" | "working" | "done" | "interrupted" | "idle";

/** 会话卡片，照电脑侧栏：第一行模型 logo + 模型、右边状态或时间；第二行标题；第三行分支。 */
function SessionCard({ index, harness, model, title, branch, status, updatedAt, issue, onOpen }: { index: number; harness: string; model: string; title: string; branch?: string | null; status: CardStatus; updatedAt: number; issue?: IssueBrief; onOpen: () => void }) {
  return (
    <button className="press-row rise-in flex w-full flex-col px-4 py-2.5 text-left" style={{ "--i": Math.min(index, 12) } as React.CSSProperties} onClick={onOpen}>
      <span className="flex w-full items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <HarnessIcon harness={harness as HarnessId} className="size-3.5 shrink-0" />
          <span className="truncate text-[12px] text-content/50">{model}</span>
        </span>
        <CardState status={status} updatedAt={updatedAt} />
      </span>
      <span className="mt-1 line-clamp-1 text-[15px] font-semibold leading-snug text-content">{title}</span>
      {branch || issue ? (
        <span className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-content/45">
          {branch ? (
            <>
              <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{branch}</span>
            </>
          ) : null}
          {/* 照电脑侧栏：挂了 issue 的在这一行右边标编号 */}
          {issue ? (
            <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-sky-400/90">
              <StatusIcon status={issue.status} className="!size-3" />#{issue.ident.split("-").pop()}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** 卡片右上角：照电脑侧栏，有状态显示状态，没有就显示多久以前。 */
function CardState({ status, updatedAt }: { status: CardStatus; updatedAt: number }) {
  const tone = status === "input" ? "text-amber-400" : status === "working" ? "text-accent" : status === "done" ? "text-emerald-400" : status === "interrupted" ? "text-red-400" : "text-content/45";
  return (
    <span className={`flex shrink-0 items-center gap-1 text-[12px] tabular-nums ${tone}`}>
      {status === "input" ? (
        <>
          <CircleAlert className="size-3" strokeWidth={1.75} />
          <span>{t("home.needsInput")}</span>
        </>
      ) : status === "working" ? (
        <>
          <TerminalSpinner className="inline-block w-3 select-none text-center text-[12px] leading-none text-accent" />
          <span>{t("home.status.working")}</span>
        </>
      ) : status === "done" ? (
        <>
          <Check className="size-3" strokeWidth={2.25} />
          <span>{t("home.status.done")}</span>
        </>
      ) : status === "interrupted" ? (
        <span>{t("home.interrupted")}</span>
      ) : (
        <span>{formatRelative(updatedAt)}</span>
      )}
    </span>
  );
}

/** 原型 v1 A 的两栏：会话（角标 = 等你处理 + 刚跑完）、Issues（角标 = 待验收，没有就显示当前迭代没做完的数）。 */
function Tabs({ tab, onTab, sessions, issues }: { tab: "sessions" | "issues"; onTab: (tab: "sessions" | "issues") => void; sessions: number; issues?: Parameters<typeof IssuesTab>[0]["data"] }) {
  const review = issues?.issues.filter((i) => i.status === "in_review").length ?? 0;
  const open = issues?.issues.filter((i) => i.current && i.status !== "done" && i.status !== "canceled").length ?? 0;
  const item = (key: "sessions" | "issues", label: string, badge: React.ReactNode) => (
    <button
      className={`press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[14px] transition-colors ${tab === key ? "bg-selection font-medium text-content" : "text-content/55"}`}
      onClick={() => {
        haptic();
        onTab(key);
      }}
    >
      {label}
      {badge}
    </button>
  );
  return (
    <div className="flex shrink-0 gap-1 border-b border-stroke px-3 py-1.5">
      {item("sessions", t("issues.tabSessions"), sessions ? <span className="rounded-full bg-amber/15 px-1.5 text-[11px] text-amber">{sessions}</span> : null)}
      {item(
        "issues",
        t("issues.tabIssues"),
        review ? <span className="rounded-full bg-sky-400/15 px-1.5 text-[11px] text-sky-400">{t("issues.toReview", { count: review })}</span> : open ? <span className="text-[12px] text-content/40">{open}</span> : null,
      )}
    </div>
  );
}

/** 项目标记：和电脑项目栏一样的像素小人，颜色按项目名算（电脑上自己改过的颜色手机上还看不到）。 */
function ProjectMark({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[10px] bg-content/[0.06]" style={{ width: size, height: size }}>
      <ProjectMascot project={name} color={projectColor(name)} className="size-[55%]" />
    </span>
  );
}

/** 直连的是 monocode-host（没走网关）：电脑上的会话看不到，告诉用户改连网关。 */
const NoGateway = () => (
  <div className="fade-in mx-4 mt-5 flex items-start gap-2.5 rounded-xl border border-stroke bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-content/55">
    <Icon name="computer" size={16} className="mt-0.5 shrink-0" />
    <span>{t("home.noGateway")}</span>
  </div>
);

/** 电脑上的一个会话：和主机上的一样的卡片，在跑时右上角是「工作中…」。 */
function MirrorRow({ item: m, index, catalog, issue, onOpen }: { item: MirrorSummary; index: number; catalog?: Parameters<typeof modelName>[0]; issue?: IssueBrief; onOpen: () => void }) {
  return (
    <SessionCard
      index={index}
      harness={m.harness}
      model={modelName(catalog, m.model)}
      title={cleanTitle(m.title) || t("session.untitled")}
      branch={m.branch}
      status={m.busy ? "working" : "idle"}
      updatedAt={m.updatedAt}
      issue={issue}
      onOpen={onOpen}
    />
  );
}

function Skeleton() {
  return (
    <div className="space-y-5 px-4 pt-6">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3" style={{ opacity: 1 - i * 0.2 }}>
          <div className="skeleton mt-1 size-2 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-3/5" />
            <div className="skeleton h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectSheet({
  open,
  onClose,
  projects,
  current,
  onChoose,
  onOpenFolder,
}: {
  open: boolean;
  onClose: () => void;
  projects: HostProject[];
  current?: string;
  onChoose: (id: string) => void;
  onOpenFolder: () => void;
}) {
  const { connection, disconnect } = useApp();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirm]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("projects.title")}
      footer={
        <div className="flex items-center gap-3">
          <Icon name="server" size={18} className="text-content/40" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-content/80">{connection.name}</div>
            <div className="truncate font-mono text-[11px] text-content/35">{connection.url}</div>
            <div className="mt-0.5 truncate text-[11px] text-content/25">{appVersion()}</div>
          </div>
          <button
            className={`press h-8 rounded-full px-3 text-[13px] transition-colors ${confirm ? "bg-red/15 text-red" : "bg-selection text-content/70"}`}
            onClick={() => (confirm ? disconnect() : setConfirm(true))}
          >
            {confirm ? t("projects.disconnectConfirm") : t("projects.disconnect")}
          </button>
        </div>
      }
    >
      {projects.map((p) => (
        <button key={p.id} className={`press press-row flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${p.id === current ? "bg-selection" : ""}`} onClick={() => onChoose(p.id)}>
          <ProjectMark name={p.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]">{p.name}</div>
            <div className="truncate font-mono text-[11px] text-content/35">{shortPath(p.cwd)}</div>
          </div>
          {p.id === current ? <Icon name="check" size={18} className="text-accent" /> : null}
        </button>
      ))}
      <button className="press press-row mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-accent" onClick={onOpenFolder}>
        <span className="grid size-[34px] place-items-center rounded-[10px] bg-accent/12">
          <Icon name="folderOpen" size={18} />
        </span>
        <span className="text-[15px]">{t("projects.openFolder")}</span>
      </button>
    </Sheet>
  );
}

/** 在主机上挑一个文件夹打开成项目。 */
function FolderSheet({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (project: HostProject) => void }) {
  const [dir, setDir] = useState<HostDirectory | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [filter, setFilter] = useState("");
  const go = (path?: string) => {
    setLoading(true);
    setFilter("");
    browse(path)
      .then(setDir)
      .catch((e) => toast(String(e.message ?? e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (open && !dir) go();
  }, [open]);
  const entries = (dir?.entries ?? []).filter((e) => !e.name.startsWith(".") && e.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("folder.title")}
      footer={
        <button
          disabled={!dir || opening}
          className="press flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-accent-ink disabled:opacity-40"
          onClick={() => {
            if (!dir) return;
            setOpening(true);
            openProject(dir.path)
              .then(onOpened)
              .catch((e) => toast(String(e.message ?? e)))
              .finally(() => setOpening(false));
          }}
        >
          {opening ? <Spinner size={16} /> : null}
          {t("folder.open", { name: dir ? dir.path.split("/").pop() || dir.path : "" })}
        </button>
      }
    >
      <div className="sticky top-0 z-10 -mx-3 bg-raised px-3 pb-2">
        <div className="flex items-center gap-2 rounded-xl bg-background-base/60 px-2 py-1.5">
          <button disabled={!dir?.parent} className="press grid size-8 place-items-center rounded-lg text-content/60 disabled:opacity-25" onClick={() => dir?.parent && go(dir.parent)}>
            <Icon name="back" size={18} />
          </button>
          <div className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-content/60" dir="rtl">
            <bdi>{dir ? shortPath(dir.path) : "…"}</bdi>
          </div>
          {loading ? <Spinner size={14} className="mr-2 text-content/40" /> : null}
        </div>
        {(dir?.entries.length ?? 0) > 10 ? (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("folder.filter")}
            className="mt-2 h-9 w-full rounded-xl border border-stroke bg-background-base/60 px-3 text-[14px] outline-none placeholder:text-content/35"
          />
        ) : null}
      </div>
      <div key={dir?.path} className="fade-in">
        {entries.map((entry) => (
          <button key={entry.path} className="press-row flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left" onClick={() => go(entry.path)}>
            <Icon name="folder" size={18} className="text-content/45" />
            <span className="flex-1 truncate text-[15px]">{entry.name}</span>
            <Icon name="chevronRight" size={16} className="text-content/25" />
          </button>
        ))}
        {dir && !entries.length ? <div className="py-8 text-center text-[13px] text-content/40">{t("folder.empty")}</div> : null}
      </div>
    </Sheet>
  );
}
