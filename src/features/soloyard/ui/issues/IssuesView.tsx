import { useState, type ReactNode } from "react";
import { useTranslation } from "../../../../i18n";
import { ExplorerMenu, type ExplorerMenuItem } from "../../../files/ui/ExplorerMenu";
import { Popover } from "../../../../shared/ui/Popover";
import { ChevronDown, ChevronRight, ListFilter, MessageSquare, Plus, SlidersHorizontal, X } from "../../../../shared/ui/icons";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import { STATUSES, statusLabel, type Issue } from "../../model/issues";
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
import { PriorityIcon, StatusIcon } from "./IssueIcons";

const shortDate = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang, { month: "short", day: "numeric" });

type MenuState = { anchor: HTMLElement; kind: "filter" } | { anchor: HTMLElement; kind: "status"; issue: Issue };

/** Issues 标签：工具栏（筛选、显示设置）+ 列表 / 看板。视图配置每个项目各存一份。 */
export function IssuesView({ project, cwd }: { project: SoloyardProject; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { data: issues = [], error } = useSoloyard<Issue[]>("listIssues", { projectId: project.id });
  const [view, setViewState] = useState(() => loadIssueView(project.id));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [displayAnchor, setDisplayAnchor] = useState<HTMLElement | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);

  const setView = (patch: Partial<IssueViewConfig>) => {
    const next = { ...view, ...patch };
    setViewState(next);
    saveIssueView(project.id, next);
  };
  const groups = applyView(issues, view);
  const groupField = view.groupBy ? ISSUE_FIELDS[view.groupBy].group : undefined;
  const openIssue = (issue: Issue) =>
    openProjectView({ cwd, view: "issue", itemId: String(issue.id), title: `${issue.ident} ${issue.title}` });
  const create = async (title: string, groupKey: string | null) => {
    const patch = groupKey && groupKey !== "all" ? (groupField?.patchFor?.(groupKey) ?? {}) : {};
    await mutateSoloyard("createIssue", project.id, { title, ...patch });
  };
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
  const visibleCount = new Set(groups.flatMap((g) => g.issues.map((i) => i.id))).size;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 窄的时候「筛选」「显示」只留图标（悬停有提示），按钮都不换行 */}
      <header className="@container/issues flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b border-stroke px-4">
        <h1 className="shrink-0 text-[13px] font-medium text-content">{t("view.issues")}</h1>
        <span className="text-[12px] text-content/40">{visibleCount}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
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
      {error ? <p className="p-4 text-[12px] text-red-400">{error}</p> : null}
      {view.layout === "list" ? (
        <ListView
          groups={groups}
          view={view}
          grouped={!!view.groupBy}
          creatingIn={creatingIn}
          setCreatingIn={setCreatingIn}
          onCreate={create}
          onOpen={openIssue}
          onStatusClick={(anchor, issue) => setMenu({ anchor, kind: "status", issue })}
        />
      ) : (
        <BoardView
          groups={groups}
          view={view}
          canMove={!!groupField?.patchFor}
          creatingIn={creatingIn}
          setCreatingIn={setCreatingIn}
          onCreate={create}
          onMove={move}
          onOpen={openIssue}
        />
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
      {menu?.kind === "status" ? (
        <ExplorerMenu
          anchor={menu.anchor}
          items={STATUSES.map((s) => ({ kind: "item" as const, id: s, label: statusLabel(s), checked: menu.issue.status === s }))}
          ariaLabel={t("issues.changeStatus")}
          width={180}
          onPick={(id) => {
            setMenu(null);
            void mutateSoloyard("updateIssue", menu.issue.id, { status: id });
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

function InlineCreate({ onCreate, onDone }: { onCreate: (title: string) => Promise<void>; onDone: () => void }) {
  const { t } = useTranslation("soloyard");
  const [title, setTitle] = useState("");
  return (
    <input
      autoFocus
      value={title}
      placeholder={t("issues.createPlaceholder")}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => !title.trim() && onDone()}
      onKeyDown={async (e) => {
        if (e.key === "Escape") onDone();
        if (e.key === "Enter" && title.trim()) {
          await onCreate(title.trim());
          setTitle("");
        }
      }}
      className="h-9 w-full border-b border-stroke bg-content/5 px-4 text-[13px] text-content outline-none placeholder:text-content/40"
    />
  );
}

/** 行 / 卡片上的属性小标签，按视图配置显示。 */
function Properties({ issue, view }: { issue: Issue; view: IssueViewConfig }) {
  const { t, i18n } = useTranslation("soloyard");
  const show = (id: FieldId) => view.properties.includes(id);
  return (
    <>
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

type ViewProps = {
  groups: IssueGroup[];
  view: IssueViewConfig;
  creatingIn: string | null;
  setCreatingIn: (key: string | null) => void;
  onCreate: (title: string, groupKey: string | null) => Promise<void>;
  onOpen: (issue: Issue) => void;
};

function GroupIcon({ view, groupKey }: { view: IssueViewConfig; groupKey: string }) {
  if (view.groupBy === "status") return <StatusIcon status={groupKey as Issue["status"]} />;
  if (view.groupBy === "priority") return <PriorityIcon priority={Number(groupKey)} />;
  return null;
}

function ListView({ groups, view, grouped, creatingIn, setCreatingIn, onCreate, onOpen, onStatusClick }: ViewProps & { grouped: boolean; onStatusClick: (anchor: HTMLElement, issue: Issue) => void }) {
  const { t } = useTranslation("soloyard");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const show = (id: FieldId) => view.properties.includes(id);
  if (!groups.length && creatingIn === null) {
    return <p className="px-4 py-10 text-center text-[13px] text-content/50">{t("issues.empty")}</p>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
      {creatingIn !== null && !groups.some((g) => g.key === creatingIn) ? (
        <InlineCreate onCreate={(t) => onCreate(t, creatingIn)} onDone={() => setCreatingIn(null)} />
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
            {creatingIn === group.key ? <InlineCreate onCreate={(t) => onCreate(t, group.key)} onDone={() => setCreatingIn(null)} /> : null}
            {open
              ? group.issues.map((issue) => (
                  <div
                    key={issue.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(issue)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(issue)}
                    className="flex h-9 cursor-default items-center gap-3 border-b border-stroke/60 px-4 text-[13px] text-content/90 hover:bg-content/5"
                  >
                    {show("priority") ? <PriorityIcon priority={issue.priority} /> : null}
                    {show("id") ? <span className="w-16 shrink-0 font-mono text-[12px] text-content/40">{issue.ident}</span> : null}
                    {show("status") ? (
                      <button
                        type="button"
                        aria-label={t("issues.statusAria", { status: statusLabel(issue.status) })}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStatusClick(e.currentTarget, issue);
                        }}
                        className="rounded p-0.5 hover:bg-content/10"
                      >
                        <StatusIcon status={issue.status} />
                      </button>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                    <Properties issue={issue} view={view} />
                  </div>
                ))
              : null}
          </section>
        );
      })}
    </div>
  );
}

function BoardView({ groups, view, canMove, creatingIn, setCreatingIn, onCreate, onMove, onOpen }: ViewProps & { canMove: boolean; onMove: (issueId: number, groupKey: string) => void }) {
  const { t } = useTranslation("soloyard");
  const [over, setOver] = useState<string | null>(null);
  const show = (id: FieldId) => view.properties.includes(id);
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-none p-3">
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
                <InlineCreate onCreate={(t) => onCreate(t, group.key)} onDone={() => setCreatingIn(null)} />
              </div>
            ) : null}
            {group.issues.map((issue) => (
              <div
                key={issue.id}
                role="button"
                tabIndex={0}
                draggable={canMove}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(issue.id))}
                onClick={() => onOpen(issue)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(issue)}
                className="flex cursor-default flex-col gap-1.5 rounded-md border border-stroke bg-background-base p-2.5 text-[13px] hover:border-content/20"
              >
                <div className="flex items-center gap-2 text-[11px] text-content/40">
                  {show("id") ? <span className="font-mono">{issue.ident}</span> : null}
                  {show("priority") ? <span className="ml-auto"><PriorityIcon priority={issue.priority} /></span> : null}
                </div>
                <div className="flex items-start gap-2 text-content/90">
                  {show("status") && view.groupBy !== "status" ? <StatusIcon status={issue.status} className="mt-0.5" /> : null}
                  <span className="line-clamp-2">{issue.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
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
