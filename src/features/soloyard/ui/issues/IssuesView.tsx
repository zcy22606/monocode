import { Fragment, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "../../../../i18n";
import { ExplorerMenu, type ExplorerMenuItem } from "../../../files/ui/ExplorerMenu";
import { Popover } from "../../../../shared/ui/Popover";
import { ChevronDown, ChevronRight, GitBranch, ListFilter, MessageSquare, Plus, Search, SlidersHorizontal, X } from "../../../../shared/ui/icons";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import { priorityLabel, repoName, statusLabel, type Issue } from "../../model/issues";
import { EMPTY_SELECTION, selectIssue, type IssueSelection } from "../../model/issueSelection";
import { mergeBeforeAccept } from "../../model/acceptIssue";
import {
  DEFAULT_VIEW,
  ISSUE_FIELDS,
  applyView,
  displayableFields,
  filterableFields,
  groupableFields,
  loadIssueView,
  saveIssueView,
  sortableFields,
  type FieldId,
  type IssueGroup,
  type IssueViewConfig,
} from "../../model/issueView";
import { openProjectView } from "../../model/projectViews";
import { NoticeBar, errorText, type Notice } from "../NoticeBar";
import { PriorityIcon, StatusIcon, priorityMenuItems, statusMenuItems } from "./IssueIcons";
import { isComposing } from "../keys";

const shortDate = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang, { month: "short", day: "numeric" });

/** 改状态 / 优先级：带 issue 是改这一条，不带是改多选的那些。 */
type MenuState = { anchor: HTMLElement; kind: "filter" } | { anchor: HTMLElement; kind: "status" | "priority"; issue?: Issue };
type Mods = Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">;

/** Issues 标签：工具栏（搜索、筛选、显示设置）+ 列表 / 看板。视图配置每个项目各存一份。 */
export function IssuesView({ project, cwd }: { project: SoloyardProject; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { data: allIssues = [], error } = useSoloyard<Issue[]>("listIssues", { projectId: project.id, includeSubIssues: true });
  // 子任务不单独占一行：折叠在主任务下面（主任务被筛掉时，子任务也不单独出现）。
  // 只列进行中迭代里的（没挂功能的也列）：还没开始的、已完成锁定的迭代都在迭代表里看
  const { issues, subIssues } = useMemo(() => {
    const split = splitSubIssues(allIssues);
    return { ...split, issues: split.issues.filter((issue) => !issue.feature_id || issue.iteration_status === "active") };
  }, [allIssues]);
  const [view, setViewState] = useState(() => loadIssueView(project.id));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [displayAnchor, setDisplayAnchor] = useState<HTMLElement | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<IssueSelection>(EMPTY_SELECTION);
  const [notice, setNotice] = useState<Notice | null>(null);

  const setView = (patch: Partial<IssueViewConfig>) => {
    const next = { ...view, ...patch };
    setViewState(next);
    saveIssueView(project.id, next);
  };
  const groups = applyView(issues, view, query);
  const groupField = view.groupBy ? ISSUE_FIELDS[view.groupBy].group : undefined;
  const openIssue = (issue: Issue) =>
    openProjectView({ cwd, view: "issue", itemId: String(issue.id), title: `${issue.ident} ${issue.title}` });
  const groupPatch = (groupKey: string) => (groupKey !== "all" ? (groupField?.patchFor?.(groupKey) ?? {}) : {});
  const inlineCreate = (groupKey: string) => (
    <InlineCreate
      defaultPriority={groupPatch(groupKey).priority ?? 0}
      onCreate={(title, priority) => mutateSoloyard<void>("createIssue", project.id, { title, ...groupPatch(groupKey), priority })}
      onDone={() => setCreatingIn(null)}
    />
  );
  const move = (issueId: number, groupKey: string) => {
    const issue = issues.find((entry) => entry.id === issueId);
    const patch = issue && groupField?.patchFor?.(groupKey, issue);
    if (patch) void mutateSoloyard("updateIssue", issueId, patch);
  };
  const toggleFilter = (field: FieldId, value: string) => {
    const current = view.filters.find((f) => f.field === field)?.values ?? [];
    const values = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setView({ filters: [...view.filters.filter((f) => f.field !== field), ...(values.length ? [{ field, values }] : [])] });
  };

  const filterItems: ExplorerMenuItem[] = filterableFields().map((field) => ({
    kind: "item",
    id: field.id,
    label: field.label(),
    submenu: field.filter!.options(issues).map((option) => ({
      kind: "item" as const,
      id: `${field.id}:${option.key}`,
      label: option.label,
      checked: view.filters.some((f) => f.field === field.id && f.values.includes(option.key)),
    })),
  }));
  // 多选只算看得见的：筛掉 / 隐藏的不参与批量操作
  const order = [...new Set(groups.flatMap((g) => g.issues.map((i) => i.id)))];
  const selected = issues.filter((i) => selection.ids.has(i.id) && order.includes(i.id));
  const toAccept = selected.filter((i) => i.status === "in_review");
  const select = (issue: Issue, e: Mods, toggle = false) =>
    setSelection((s) => selectIssue(s, issue.id, order, { shift: e.shiftKey, toggle: toggle || e.metaKey || e.ctrlKey }));
  const rowClick = (issue: Issue, e: Mods) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) return select(issue, e);
    setSelection(EMPTY_SELECTION);
    openIssue(issue);
  };
  /** 批量改：一个 batch，提示条里能整批撤销。 */
  const bulk = async (ids: number[], patch: Partial<Issue>, message: string) => {
    try {
      const batch = await mutateSoloyard<string | null>("updateIssues", ids, patch);
      setNotice(batch ? { kind: "undo", batch, message } : null);
    } catch (e) {
      setNotice({ kind: "error", message: errorText(e) });
    }
  };
  // 批量通过：在工作树里做的先逐个合并进仓库主分支，合不了的留在待验收并列出原因，其余照旧一批改成 done（可撤销状态，合并不撤）
  const acceptMany = async (targets: Issue[]) => {
    const ok: number[] = [];
    const failures: string[] = [];
    for (const issue of targets) {
      try {
        const reason = await mergeBeforeAccept(issue.id);
        if (reason) failures.push(`${issue.ident}: ${reason}`);
        else ok.push(issue.id);
      } catch (e) {
        failures.push(`${issue.ident}: ${errorText(e)}`);
      }
    }
    if (ok.length) await bulk(ok, { status: "done" }, t("issues.bulk.accepted", { count: ok.length }));
    if (failures.length) setNotice({ kind: "error", message: [t("merge.bulkFailed", { count: failures.length }), ...failures].join("\n") });
  };
  const undo = async (batch: string) => {
    try {
      await mutateSoloyard("revertBatch", batch);
      setNotice(null);
    } catch (e) {
      setNotice({ kind: "error", message: errorText(e) });
    }
  };
  // 只有标了仓库的 issue 时才占「仓库」这一列（单仓库项目不显示空列）
  const hasRepos = allIssues.some((i) => i.repo_path);
  const rowProps = {
    subIssues,
    view: hasRepos ? view : { ...view, properties: view.properties.filter((p) => p !== "repo") },
    selectedIds: selection.ids,
    selecting: selected.length > 0,
    creatingIn,
    setCreatingIn,
    inlineCreate,
    onRowClick: rowClick,
    onCheck: (issue: Issue, e: Mods) => select(issue, e, true),
    onPropertyClick: (anchor: HTMLElement, kind: "status" | "priority", issue: Issue) => setMenu({ anchor, kind, issue }),
  };

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={(e) => e.key === "Escape" && selection.ids.size && setSelection(EMPTY_SELECTION)}>
      {/* 窄的时候「筛选」「显示」只留图标（悬停有提示），按钮都不换行 */}
      <header className="@container/issues flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b border-stroke px-4">
        <h1 className="shrink-0 text-[13px] font-medium text-content">{t("view.issues")}</h1>
        <span className="text-[12px] text-content/40">{order.length}</span>
        <label className="ml-auto flex h-7 w-48 min-w-20 shrink items-center gap-1.5 rounded-md border border-stroke px-2 text-content/50 focus-within:border-content/30">
          <Search className="size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={t("issues.search")}
            aria-label={t("issues.search")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/40"
          />
          {query ? (
            <button type="button" aria-label={t("issues.clearSearch")} onClick={() => setQuery("")} className="rounded p-0.5 hover:bg-content/10 hover:text-content">
              <X className="size-3" />
            </button>
          ) : null}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <ToolbarButton
            label={t("issues.filter")}
            active={view.filters.length > 0}
            onClick={(el) => setMenu(menu?.kind === "filter" ? null : { anchor: el, kind: "filter" })}
          >
            <ListFilter className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label={t("issues.display")} active={!!displayAnchor} onClick={(el) => setDisplayAnchor(displayAnchor ? null : el)}>
            <SlidersHorizontal className="size-3.5" />
          </ToolbarButton>
          <button
            type="button"
            onClick={() => setCreatingIn(groups[0]?.key ?? "all")}
            className="flex h-7 items-center gap-1 rounded-md bg-content/10 px-2 text-[12px] text-content hover:bg-content/15"
          >
            <Plus className="size-3.5" />
            {t("issues.newIssue")}
          </button>
        </div>
      </header>
      {view.filters.length ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-stroke px-4 py-1.5">
          {view.filters.map((f) => (
            <span key={f.field} className="flex h-6 items-center gap-1 rounded-md bg-content/10 pl-2 pr-1 text-[12px] text-content/80">
              <span className="text-content/50">{ISSUE_FIELDS[f.field].label()}:</span>
              {f.values.map((v) => ISSUE_FIELDS[f.field].filter!.options(issues).find((o) => o.key === v)?.label ?? v).join(", ")}
              <button
                type="button"
                aria-label={t("issues.clearFilter", { field: ISSUE_FIELDS[f.field].label() })}
                onClick={() => setView({ filters: view.filters.filter((x) => x.field !== f.field) })}
                className="rounded p-0.5 text-content/50 hover:bg-content/10 hover:text-content"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {selected.length ? (
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap border-b border-stroke bg-selection/50 px-4 py-1 text-[12px]">
          <span className="mr-1 text-content/70">{t("issues.bulk.selected", { count: selected.length })}</span>
          <button
            type="button"
            disabled={!toAccept.length}
            title={t("issues.bulk.acceptHint")}
            onClick={() => void acceptMany(toAccept)}
            className="flex h-6 items-center gap-1.5 rounded-md bg-accent px-2 font-medium text-white hover:opacity-90 disabled:bg-content/10 disabled:text-content/40 disabled:hover:opacity-100"
          >
            {t("issues.bulk.accept", { count: toAccept.length })}
          </button>
          {(["status", "priority"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={(e) => setMenu({ anchor: e.currentTarget, kind })}
              className="flex h-6 items-center gap-1 rounded-md px-2 text-content/70 hover:bg-content/10 hover:text-content"
            >
              {t(`field.${kind}`)}
              <ChevronDown className="size-3" />
            </button>
          ))}
          <button type="button" aria-label={t("issues.bulk.clear")} title={t("issues.bulk.clear")} onClick={() => setSelection(EMPTY_SELECTION)} className="ml-auto rounded p-0.5 text-content/50 hover:bg-content/10 hover:text-content">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {notice ? <NoticeBar notice={notice} onUndo={(batch) => void undo(batch)} onClose={() => setNotice(null)} /> : null}
      {error ? <p className="p-4 text-[12px] text-red-400">{error}</p> : null}
      {query.trim() && !order.length && creatingIn === null ? (
        <p className="px-4 py-10 text-center text-[13px] text-content/50">{t("issues.noMatches", { query: query.trim() })}</p>
      ) : view.layout === "list" ? (
        <ListView
          groups={groups}
          grouped={!!view.groupBy}
          allSelected={order.length > 0 && selected.length === order.length}
          onSelectAll={(all) => setSelection(all ? { ids: new Set(order), anchor: null } : EMPTY_SELECTION)}
          {...rowProps}
        />
      ) : (
        <BoardView groups={groups} canMove={!!groupField?.patchFor} onMove={move} {...rowProps} />
      )}
      {menu?.kind === "filter" ? (
        <ExplorerMenu
          anchor={menu.anchor}
          items={filterItems}
          ariaLabel={t("issues.filterMenu")}
          width={200}
          onPick={(id) => {
            const [field, value] = id.split(/:(.*)/s);
            if (value !== undefined) toggleFilter(field as FieldId, value);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu && menu.kind !== "filter" ? (
        <ExplorerMenu
          anchor={menu.anchor}
          items={menu.kind === "status" ? statusMenuItems(menu.issue?.status) : priorityMenuItems(menu.issue?.priority)}
          ariaLabel={menu.kind === "status" ? t("issues.changeStatus") : t("issues.changePriority")}
          width={180}
          onPick={(id) => {
            setMenu(null);
            const patch: Partial<Issue> = menu.kind === "status" ? { status: id as Issue["status"] } : { priority: Number(id) };
            if (menu.issue) void mutateSoloyard("updateIssue", menu.issue.id, patch);
            else void bulk(selected.map((i) => i.id), patch, t("issues.bulk.updated", { count: selected.length }));
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {displayAnchor ? (
        <Popover anchor={displayAnchor} side="bottom" align="end" width={300} onDismiss={() => setDisplayAnchor(null)}>
          <DisplayOptions view={view} setView={setView} />
        </Popover>
      ) : null}
    </div>
  );
}

function ToolbarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: (el: HTMLElement) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => onClick(event.currentTarget)}
      className={`flex h-7 items-center gap-1 rounded-md px-2 text-[12px] ${active ? "bg-selection text-content" : "text-content/60 hover:bg-content/10 hover:text-content"}`}
    >
      {children}
      <span className="hidden @md/issues:inline">{label}</span>
    </button>
  );
}

/** 显示设置：布局、分组（看板的列）、排序、已完成 / 空分组、显示哪些属性。 */
function DisplayOptions({ view, setView }: { view: IssueViewConfig; setView: (patch: Partial<IssueViewConfig>) => void }) {
  const { t } = useTranslation("soloyard");
  const row = "flex h-8 items-center justify-between gap-3 text-[12px] text-content/70";
  const select = "h-7 rounded-md border border-stroke bg-background-base px-1.5 text-[12px] text-content";
  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-content/5 p-0.5">
        {(["list", "board"] as const).map((layout) => (
          <button
            key={layout}
            type="button"
            aria-pressed={view.layout === layout}
            onClick={() => setView({ layout })}
            className={`h-7 rounded-md text-[12px] ${view.layout === layout ? "bg-selection text-content" : "text-content/60 hover:text-content"}`}
          >
            {t(`issues.layout.${layout}`)}
          </button>
        ))}
      </div>
      <label className={row}>
        {view.layout === "board" ? t("issues.columns") : t("issues.grouping")}
        <select className={select} value={view.groupBy ?? ""} onChange={(e) => setView({ groupBy: (e.target.value || null) as FieldId | null })}>
          <option value="">{t("issues.noGrouping")}</option>
          {groupableFields().map((f) => <option key={f.id} value={f.id}>{f.label()}</option>)}
        </select>
      </label>
      <label className={row}>
        {t("issues.ordering")}
        <span className="flex items-center gap-1">
          <select className={select} value={view.orderBy} onChange={(e) => setView({ orderBy: e.target.value as FieldId })}>
            {sortableFields().map((f) => <option key={f.id} value={f.id}>{f.label()}</option>)}
          </select>
          <button type="button" title={t("issues.reverseOrder")} onClick={() => setView({ orderDesc: !view.orderDesc })} className="h-7 rounded-md border border-stroke px-1.5 text-[12px] text-content/70 hover:text-content">
            {view.orderDesc ? "↓" : "↑"}
          </button>
        </span>
      </label>
      <Toggle label={t("issues.showCompleted")} on={view.showCompleted} onChange={(showCompleted) => setView({ showCompleted })} />
      <Toggle label={t("issues.showEmpty")} on={view.showEmptyGroups} onChange={(showEmptyGroups) => setView({ showEmptyGroups })} />
      <div className="mt-2 border-t border-stroke pt-2 text-[12px] text-content/50">{t("issues.displayProperties")}</div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {displayableFields().map((f) => {
          const on = view.properties.includes(f.id);
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setView({ properties: on ? view.properties.filter((p) => p !== f.id) : [...view.properties, f.id] })}
              className={`h-6 rounded-md border px-2 text-[12px] ${on ? "border-transparent bg-selection text-content" : "border-stroke text-content/50 hover:text-content"}`}
            >
              {f.label()}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setView(DEFAULT_VIEW)} className="mt-2 self-end text-[12px] text-content/50 hover:text-content">
        {t("issues.reset")}
      </button>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex h-8 items-center justify-between text-[12px] text-content/70">
      {label}
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? "bg-accent" : "bg-content/20"}`}>
        <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** 行内新建：标题 + 优先级（默认取所在分组的；连续新建时沿用上一次选的）。 */
function InlineCreate({ defaultPriority, onCreate, onDone }: { defaultPriority: number; onCreate: (title: string, priority: number) => Promise<void>; onDone: () => void }) {
  const { t } = useTranslation("soloyard");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(defaultPriority);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const closePicker = () => {
    setPicker(null);
    input.current?.focus();
  };
  return (
    <div className="flex h-9 w-full items-center gap-2 border-b border-stroke bg-content/5 px-4">
      <button
        type="button"
        aria-label={t("issues.priorityAria", { priority: priorityLabel(priority) })}
        title={t("issues.changePriority")}
        onMouseDown={(e) => e.preventDefault()} // 不抢输入框焦点：标题为空时失焦会关掉新建
        onClick={(e) => setPicker(e.currentTarget)}
        className="rounded p-0.5 hover:bg-content/10"
      >
        <PriorityIcon priority={priority} />
      </button>
      <input
        ref={input}
        autoFocus
        value={title}
        placeholder={t("issues.createPlaceholder")}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && !picker && onDone()}
        onKeyDown={async (e) => {
          if (isComposing(e)) return;
          if (e.key === "Escape") onDone();
          if (e.key === "Enter" && title.trim()) {
            await onCreate(title.trim(), priority);
            setTitle("");
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
      />
      {picker ? (
        <ExplorerMenu
          anchor={picker}
          items={priorityMenuItems(priority)}
          ariaLabel={t("issues.changePriority")}
          width={180}
          onPick={(id) => {
            setPriority(Number(id));
            closePicker();
          }}
          onClose={closePicker}
        />
      ) : null}
    </div>
  );
}

/** 行 / 卡片上的勾选框：多选时一直显示，平时悬停才显示。 */
function SelectBox({ issue, checked, selecting, onCheck }: { issue: Issue; checked: boolean; selecting: boolean; onCheck: (issue: Issue, e: Mods) => void }) {
  const { t } = useTranslation("soloyard");
  return (
    <input
      type="checkbox"
      readOnly
      checked={checked}
      aria-label={t("issues.selectAria", { ident: issue.ident })}
      title={t("issues.selectHint")}
      onClick={(e) => {
        e.stopPropagation();
        onCheck(issue, e);
      }}
      onKeyDown={(e) => e.stopPropagation()} // 空格 / 回车只勾选，不打开 issue
      className={`shrink-0 accent-[var(--color-accent)] ${checked || selecting ? "" : "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"}`}
    />
  );
}

/** 行 / 卡片上可点的状态、优先级图标：点开菜单直接改，不进详情。 */
function PropertyButton({ issue, kind, onClick, className = "" }: { issue: Issue; kind: "status" | "priority"; onClick: (anchor: HTMLElement, kind: "status" | "priority", issue: Issue) => void; className?: string }) {
  const { t } = useTranslation("soloyard");
  const label = kind === "status" ? t("issues.statusAria", { status: statusLabel(issue.status) }) : t("issues.priorityAria", { priority: priorityLabel(issue.priority) });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.currentTarget, kind, issue);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`shrink-0 rounded p-0.5 hover:bg-content/10 ${className}`}
    >
      {kind === "status" ? <StatusIcon status={issue.status} /> : <PriorityIcon priority={issue.priority} />}
    </button>
  );
}

/** 行 / 卡片上的属性小标签，按视图配置显示。 */
/** 列表的列宽：表头和每行共用，才能对齐。 */
const COL = { priority: "w-12", id: "w-16", status: "w-12", repo: "w-36", labels: "w-40", sessions: "w-12", date: "w-14" };

function Properties({ issue, view, list = false }: { issue: Issue; view: IssueViewConfig; list?: boolean }) {
  const { t, i18n } = useTranslation("soloyard");
  const show = (id: FieldId) => view.properties.includes(id);
  if (list) {
    return (
      <>
        {show("repo") ? (
          <span className={`${COL.repo} flex shrink-0 items-center justify-end gap-1 truncate text-[11.5px] text-content/55`} title={issue.repo_path ?? undefined}>
            {issue.repo_path ? <><GitBranch className="size-3 shrink-0 opacity-70" /><span className="truncate">{repoName(issue.repo_path)}</span></> : null}
          </span>
        ) : null}
        {show("labels") ? (
          <span className={`${COL.labels} flex shrink-0 justify-end gap-1 overflow-hidden`} title={issue.labels.join(", ") || undefined}>
            {issue.labels.map((label) => (
              <span key={label} className="h-5 shrink-0 rounded-full border border-stroke px-2 text-[11px] leading-[18px] text-content/60">{label}</span>
            ))}
          </span>
        ) : null}
        {show("sessions") ? (
          <span className={`${COL.sessions} flex shrink-0 items-center justify-end gap-0.5 text-[11px] text-content/50`} title={issue.sessions ? t("issues.linkedSessions", { count: issue.sessions }) : undefined}>
            {issue.sessions ? <><MessageSquare className="size-3" />{issue.sessions}</> : null}
          </span>
        ) : null}
        {show("created") ? <span className={`${COL.date} shrink-0 text-right text-[11px] text-content/40`}>{shortDate(issue.created_at, i18n.language)}</span> : null}
        {show("updated") ? <span className={`${COL.date} shrink-0 text-right text-[11px] text-content/40`}>{shortDate(issue.updated_at, i18n.language)}</span> : null}
      </>
    );
  }
  return (
    <>
      {show("repo") && issue.repo_path ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-content/55" title={issue.repo_path}>
          <GitBranch className="size-3 opacity-70" />
          {repoName(issue.repo_path)}
        </span>
      ) : null}
      {show("labels")
        ? issue.labels.map((label) => (
            <span key={label} className="h-5 shrink-0 rounded-full border border-stroke px-2 text-[11px] leading-[18px] text-content/60">{label}</span>
          ))
        : null}
      {show("sessions") && issue.sessions > 0 ? (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-content/50" title={t("issues.linkedSessions", { count: issue.sessions })}>
          <MessageSquare className="size-3" />
          {issue.sessions}
        </span>
      ) : null}
      {show("created") ? <span className="shrink-0 text-[11px] text-content/40" title={t("field.created")}>{shortDate(issue.created_at, i18n.language)}</span> : null}
      {show("updated") ? <span className="shrink-0 text-[11px] text-content/40" title={t("field.updated")}>{shortDate(issue.updated_at, i18n.language)}</span> : null}
    </>
  );
}

/** 列表的表头：每列叫什么；最左边的勾选框是全选 / 全不选。 */
function ListHeader({ view, allSelected, someSelected, onSelectAll }: { view: IssueViewConfig; allSelected: boolean; someSelected: boolean; onSelectAll: (all: boolean) => void }) {
  const { t } = useTranslation("soloyard");
  const show = (id: FieldId) => view.properties.includes(id);
  const cell = (id: FieldId, width: string, right = false) =>
    show(id) ? <span className={`${width} shrink-0 truncate ${right ? "text-right" : ""}`}>{t(`field.${id}`)}</span> : null;
  return (
    <div className="flex h-8 shrink-0 select-none items-center gap-3 border-b border-stroke pl-2 pr-4 text-[11px] text-content/40">
      <input
        type="checkbox"
        readOnly
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = someSelected && !allSelected;
        }}
        aria-label={t("issues.selectAll")}
        title={t("issues.selectAll")}
        onClick={() => onSelectAll(!allSelected)}
        className="shrink-0 accent-[var(--color-accent)]"
      />
      {cell("priority", COL.priority)}
      {cell("id", COL.id)}
      {cell("status", COL.status)}
      <span className="min-w-0 flex-1 truncate">{t("field.title")}</span>
      {cell("repo", COL.repo, true)}
      {cell("labels", COL.labels, true)}
      {cell("sessions", COL.sessions, true)}
      {cell("created", COL.date, true)}
      {cell("updated", COL.date, true)}
    </div>
  );
}

type ViewProps = {
  groups: IssueGroup[];
  /** 主任务 id → 它的子任务（列表里折叠在主任务下面，看板上只显示进度）。 */
  subIssues: Map<number, Issue[]>;
  view: IssueViewConfig;
  selectedIds: Set<number>;
  selecting: boolean;
  creatingIn: string | null;
  setCreatingIn: (key: string | null) => void;
  inlineCreate: (groupKey: string) => ReactNode;
  onRowClick: (issue: Issue, e: Mods) => void;
  onCheck: (issue: Issue, e: Mods) => void;
  onPropertyClick: (anchor: HTMLElement, kind: "status" | "priority", issue: Issue) => void;
};

function GroupIcon({ view, groupKey }: { view: IssueViewConfig; groupKey: string }) {
  if (view.groupBy === "status") return <StatusIcon status={groupKey as Issue["status"]} />;
  if (view.groupBy === "priority") return <PriorityIcon priority={Number(groupKey)} />;
  return null;
}

function ListView({ groups, subIssues, view, grouped, selectedIds, selecting, allSelected, onSelectAll, creatingIn, setCreatingIn, inlineCreate, onRowClick, onCheck, onPropertyClick }: ViewProps & { grouped: boolean; allSelected: boolean; onSelectAll: (all: boolean) => void }) {
  const { t } = useTranslation("soloyard");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const show = (id: FieldId) => view.properties.includes(id);
  const toggleSubs = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const row = (issue: Issue, sub = false) => {
    const subs = sub ? [] : (subIssues.get(issue.id) ?? []);
    const open = expanded.has(issue.id);
    return (
      <div
        key={issue.id}
        role="button"
        tabIndex={0}
        aria-selected={selectedIds.has(issue.id)}
        onClick={(e) => (sub ? onRowClick(issue, { shiftKey: false, metaKey: false, ctrlKey: false }) : onRowClick(issue, e))}
        onKeyDown={(e) => e.key === "Enter" && onRowClick(issue, e)}
        className={`group/row flex h-9 cursor-default select-none items-center gap-3 border-b border-stroke/60 pr-4 text-[13px] text-content/90 ${sub ? "pl-8" : "pl-2"} ${selectedIds.has(issue.id) ? "bg-selection" : "hover:bg-content/5"}`}
      >
        {sub ? <span className="size-3.5 shrink-0" /> : <SelectBox issue={issue} checked={selectedIds.has(issue.id)} selecting={selecting} onCheck={onCheck} />}
        {show("priority") ? <span className={`${COL.priority} shrink-0`}><PropertyButton issue={issue} kind="priority" onClick={onPropertyClick} className="-ml-0.5" /></span> : null}
        {show("id") ? <span className={`${COL.id} shrink-0 font-mono text-[12px] text-content/40`}>{issue.ident}</span> : null}
        {show("status") ? <span className={`${COL.status} shrink-0`}><PropertyButton issue={issue} kind="status" onClick={onPropertyClick} className="-ml-0.5" /></span> : null}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate">{issue.title}</span>
          {subs.length ? (
            <button
              type="button"
              aria-expanded={open}
              title={t(open ? "issues.hideSubIssues" : "issues.showSubIssues")}
              onClick={(e) => {
                e.stopPropagation();
                toggleSubs(issue.id);
              }}
              className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-[11px] text-content/50 hover:bg-content/10 hover:text-content"
            >
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {subs.filter((s) => s.status === "done").length}/{subs.length}
            </button>
          ) : null}
        </span>
        <Properties issue={issue} view={view} list />
      </div>
    );
  };
  if (!groups.length && creatingIn === null) {
    return <p className="px-4 py-10 text-center text-[13px] text-content/50">{t("issues.empty")}</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListHeader view={view} allSelected={allSelected} someSelected={selecting} onSelectAll={onSelectAll} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {creatingIn !== null && !groups.some((g) => g.key === creatingIn) ? (
          inlineCreate(creatingIn)
        ) : null}
        {groups.map((group) => {
          const open = !collapsed.has(group.key);
          return (
            <section key={group.key}>
              {grouped ? (
                <div className="group sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-stroke bg-background-base px-4 text-[12px] text-content/70">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })}
                    className="flex items-center gap-2"
                  >
                    {open ? <ChevronDown className="size-3 text-content/40" /> : <ChevronRight className="size-3 text-content/40" />}
                    <GroupIcon view={view} groupKey={group.key} />
                    <span className="font-medium text-content">{group.label}</span>
                    <span className="text-content/40">{group.issues.length}</span>
                  </button>
                  <button type="button" aria-label={t("issues.newIn", { group: group.label })} onClick={() => setCreatingIn(group.key)} className="ml-auto rounded p-1 text-content/40 opacity-0 hover:bg-content/10 hover:text-content group-hover:opacity-100">
                    <Plus className="size-3.5" />
                  </button>
                </div>
              ) : null}
              {creatingIn === group.key ? inlineCreate(group.key) : null}
              {open
                ? group.issues.map((issue) => (
                    <Fragment key={issue.id}>
                      {row(issue)}
                      {expanded.has(issue.id) ? (subIssues.get(issue.id) ?? []).map((sub) => row(sub, true)) : null}
                    </Fragment>
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardView({ groups, subIssues, view, canMove, selectedIds, selecting, creatingIn, setCreatingIn, inlineCreate, onRowClick, onCheck, onPropertyClick, onMove }: ViewProps & { canMove: boolean; onMove: (issueId: number, groupKey: string) => void }) {
  const { t } = useTranslation("soloyard");
  const [over, setOver] = useState<string | null>(null);
  const show = (id: FieldId) => view.properties.includes(id);
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-none p-3">
      {/* 还没有任何分组（项目里一个 issue 都没有）时，新建落在一个临时列里，和列表视图一样 */}
      {creatingIn !== null && !groups.some((g) => g.key === creatingIn) ? (
        <section className="flex w-72 shrink-0 flex-col self-start rounded-lg bg-content/5 p-2">
          <div className="overflow-hidden rounded-md border border-stroke">{inlineCreate(creatingIn)}</div>
        </section>
      ) : null}
      {groups.map((group) => (
        <section
          key={group.key}
          onDragOver={(e) => {
            if (!canMove) return;
            e.preventDefault();
            setOver(group.key);
          }}
          onDragLeave={() => setOver((key) => (key === group.key ? null : key))}
          onDrop={(e) => {
            setOver(null);
            const id = Number(e.dataTransfer.getData("text/plain"));
            if (canMove && id) onMove(id, group.key);
          }}
          className={`flex w-72 shrink-0 flex-col rounded-lg ${over === group.key ? "bg-content/10" : "bg-content/5"}`}
        >
          <div className="flex h-9 shrink-0 items-center gap-2 px-3 text-[12px]">
            <GroupIcon view={view} groupKey={group.key} />
            <span className="font-medium text-content">{group.label}</span>
            <span className="text-content/40">{group.issues.length}</span>
            <button type="button" aria-label={t("issues.newIn", { group: group.label })} onClick={() => setCreatingIn(group.key)} className="ml-auto rounded p-1 text-content/40 hover:bg-content/10 hover:text-content">
              <Plus className="size-3.5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {creatingIn === group.key ? (
              <div className="overflow-hidden rounded-md border border-stroke">
                {inlineCreate(group.key)}
              </div>
            ) : null}
            {group.issues.map((issue) => (
              <div
                key={issue.id}
                role="button"
                tabIndex={0}
                draggable={canMove}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(issue.id))}
                aria-selected={selectedIds.has(issue.id)}
                onClick={(e) => onRowClick(issue, e)}
                onKeyDown={(e) => e.key === "Enter" && onRowClick(issue, e)}
                className={`group/row flex cursor-default select-none flex-col gap-1.5 rounded-md border p-2.5 text-[13px] ${selectedIds.has(issue.id) ? "border-accent/60 bg-selection" : "border-stroke bg-background-base hover:border-content/20"}`}
              >
                <div className="flex items-center gap-2 text-[11px] text-content/40">
                  <SelectBox issue={issue} checked={selectedIds.has(issue.id)} selecting={selecting} onCheck={onCheck} />
                  {show("id") ? <span className="font-mono">{issue.ident}</span> : null}
                  {show("priority") ? <PropertyButton issue={issue} kind="priority" onClick={onPropertyClick} className="-m-0.5 ml-auto" /> : null}
                </div>
                <div className="flex items-start gap-2 text-content/90">
                  {show("status") && view.groupBy !== "status" ? <StatusIcon status={issue.status} className="mt-0.5" /> : null}
                  <span className="line-clamp-2">{issue.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {subIssues.get(issue.id)?.length ? (
                    <span className="shrink-0 rounded-full border border-stroke px-1.5 text-[11px] text-content/55" title={t("detail.subIssues")}>
                      {subIssues.get(issue.id)!.filter((s) => s.status === "done").length}/{subIssues.get(issue.id)!.length}
                    </span>
                  ) : null}
                  <Properties issue={issue} view={view} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 列表的顶层是没有主任务（或主任务不在这个项目里）的 issue；子任务按主任务归组。 */
export function splitSubIssues(all: Issue[]): { issues: Issue[]; subIssues: Map<number, Issue[]> } {
  const ids = new Set(all.map((i) => i.id));
  const subIssues = new Map<number, Issue[]>();
  const issues: Issue[] = [];
  for (const issue of all) {
    if (issue.parent_id != null && ids.has(issue.parent_id)) subIssues.set(issue.parent_id, [...(subIssues.get(issue.parent_id) ?? []), issue]);
    else issues.push(issue);
  }
  return { issues, subIssues };
}
