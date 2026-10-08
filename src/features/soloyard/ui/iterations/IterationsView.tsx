/**
 * 迭代：功能全景 = 一张带版本号的迭代表。每个迭代一列，从左到右就是优先级；最后是「待定」「另立项」「不做」三列。
 * 减法 = 把功能挪到别的迭代或特殊列；开始迭代 = 给勾选的功能各建一个 issue；完成迭代 = 处理没做完的功能并锁定。
 * 数据在 soloyard/core/src/iterations.ts；多步操作返回 batch，顶部的「撤销」按 batch 整批回滚。
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { ExplorerMenu, type ExplorerMenuItem } from "../../../files/ui/ExplorerMenu";
import { ChevronDown, ChevronRight, ListFilter, MoreHorizontal, Plus, Search, Trash2, X } from "../../../../shared/ui/icons";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import {
  aiMovedFrom,
  columnLabel,
  columnsOf,
  encodeTarget,
  iterationLabel,
  planLabel,
  targetOf,
  unfinished,
  type Column,
  type Feature,
  type Iteration,
  type IterationPlan,
  type Target,
} from "../../model/iterations";
import { openProjectView } from "../../model/projectViews";
import { StatusIcon } from "../issues/IssueIcons";
import { NoticeBar, errorText, type Notice } from "../NoticeBar";
import { DeleteIterationDialog, FinishIterationDialog, IterationFormDialog, NewFeatureDialog, StartIterationDialog } from "./IterationDialogs";
import { isComposing } from "../keys";

const FEATURE_DRAG = "application/x-soloyard-feature";
const ITERATION_DRAG = "application/x-soloyard-iteration";
const LAYOUT_KEY = "soloyard.iterationsLayout";
/** 「减过头」只看这两类：竞品普遍都有，砍掉或推得太后要提醒。 */
const ESSENTIAL = new Set(["必备", "常见"]);
const NO_BACKBONE = "—";

type Layout = "board" | "list";
type Menu = { anchor: HTMLElement; kind: "iteration"; id: number } | { anchor: HTMLElement; kind: "backbones" | "toolbar" } | { anchor: HTMLElement; kind: "move"; id: number };
/** 顶部提示条：多步操作后的撤销，或操作失败的原因。 */

/** 元素当前宽度（ResizeObserver）。 */
function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const ref = useCallback((node: T | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}


export function IterationsView({ project, cwd }: { project: SoloyardProject; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { data: plan, error } = useSoloyard<IterationPlan>("iterationPlan", project.id);
  if (error) return <p className="p-6 text-[12px] text-red-400">{error}</p>;
  if (!plan) return <p className="p-6 text-[12px] text-content/40">{t("iterations.loading")}</p>;
  return <Iterations plan={plan} project={project} cwd={cwd} />;
}

function Iterations({ plan, project, cwd }: { plan: IterationPlan; project: SoloyardProject; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { iterations, features, backbones: backboneNames } = plan;
  const [layout, setLayoutState] = useState<Layout>(() => (localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "board"));
  const [backbones, setBackbones] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [showOvercut, setShowOvercut] = useState(false);
  /** null = 不显示；editing 为空 = 新建。 */
  const [form, setForm] = useState<{ editing?: Iteration } | null>(null);
  const [removing, setRemoving] = useState<Iteration | null>(null);
  const [starting, setStarting] = useState<Iteration | null>(null);
  const [finishing, setFinishing] = useState<Iteration | null>(null);
  const [newFeature, setNewFeature] = useState<Target | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // 工具栏放不下时，从低优先级开始收进「⋯」菜单：新建功能 → 骨干筛选 → 看板 / 列表；计数最先隐藏
  const [headerRef, headerWidth] = useWidth<HTMLElement>();
  const fits = {
    count: headerWidth >= 760,
    newFeature: headerWidth >= 700,
    backbones: headerWidth >= 600,
    layout: headerWidth >= 460,
  };
  const allFit = fits.newFeature && fits.backbones && fits.layout;
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    localStorage.setItem(LAYOUT_KEY, next);
  };

  /** 单步操作：失败就在顶部显示原因（比如迭代刚被别处锁定）。 */
  const act = async (method: string, ...args: unknown[]) => {
    try {
      await mutateSoloyard(method, ...args);
      setNotice((n) => (n?.kind === "error" ? null : n));
    } catch (e) {
      setNotice({ kind: "error", message: errorText(e) });
    }
  };
  /** 多步操作：成功后提供整批撤销；失败抛给调用方（弹窗里显示原因）。 */
  const actBatch = async (message: string, method: string, ...args: unknown[]) => {
    const batch = await mutateSoloyard<string>(method, ...args);
    setNotice({ kind: "undo", batch, message });
  };
  const undo = async (batch: string) => {
    try {
      await mutateSoloyard("revertBatch", batch);
      setNotice(null);
    } catch (e) {
      setNotice({ kind: "error", message: errorText(e) });
    }
  };

  const columns = columnsOf(iterations);
  const releaseIds = iterations.map((i) => i.id);
  const byId = useMemo(() => new Map(iterations.map((i) => [i.id, i])), [iterations]);
  const lockedTarget = (target: Target) => typeof target === "number" && byId.get(target)?.status === "done";
  const targetLabel = (target: Target) => {
    const col = columns.find((c) => c.target === target);
    return col ? columnLabel(col) : String(target);
  };
  const overcut = features.filter((f) => {
    if (!f.level || !ESSENTIAL.has(f.level)) return false;
    const index = f.iteration_id ? releaseIds.indexOf(f.iteration_id) : -1;
    return index < 0 || index >= 2;
  });
  const visible = features.filter(
    (f) =>
      (!backbones.size || backbones.has(f.backbone ?? NO_BACKBONE)) &&
      (!q.trim() || `${f.code} ${f.name}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      (!showOvercut || overcut.includes(f)),
  );
  const byColumn = new Map<string, Feature[]>(columns.map((c) => [encodeTarget(c.target), []]));
  for (const f of visible) byColumn.get(encodeTarget(targetOf(f)))?.push(f);
  const inColumn = (target: Target) => features.filter((f) => targetOf(f) === target);
  const feature = selected != null ? features.find((f) => f.id === selected) : undefined;
  const backboneLabel = (bb: string) => (bb === NO_BACKBONE ? t("iterations.noBackbone") : `${bb} ${backboneNames[bb] ?? ""}`.trim());
  const moveFeature = (f: Feature, target: Target) => {
    if (targetOf(f) === target || lockedTarget(targetOf(f)) || lockedTarget(target)) return;
    void act("moveFeatures", [f.id], target);
  };

  const iterationMenu = (id: number): ExplorerMenuItem[] => {
    const it = byId.get(id)!;
    const index = releaseIds.indexOf(id);
    return [
      ...(it.status === "planned" ? [{ kind: "item" as const, id: "start", label: t("iterations.start") }] : []),
      ...(it.status === "active" ? [{ kind: "item" as const, id: "finish", label: t("iterations.finish") }] : []),
      ...(it.status === "done" ? [{ kind: "item" as const, id: "reopen", label: t("iterations.reopen") }] : []),
      { kind: "item", id: "earlier", label: t("iterations.earlier"), disabled: index <= 0 },
      { kind: "item", id: "later", label: t("iterations.later"), disabled: index >= releaseIds.length - 1 },
      { kind: "item", id: "addFeature", label: t("iterations.newFeature.action"), disabled: it.status === "done" },
      { kind: "item", id: "edit", label: t("iterations.edit") },
      { kind: "sep" },
      { kind: "item", id: "delete", label: t("iterations.remove.action"), danger: true },
    ];
  };
  const onIterationMenu = (id: number, action: string) => {
    const it = byId.get(id)!;
    const index = releaseIds.indexOf(id);
    if (action === "start") setStarting(it);
    if (action === "finish") setFinishing(it);
    if (action === "reopen") void act("reopenIteration", id);
    if (action === "earlier") void act("moveIteration", id, releaseIds[index - 1]);
    if (action === "later") void act("moveIteration", id, releaseIds[index + 2] ?? null);
    if (action === "addFeature") setNewFeature(id);
    if (action === "edit") setForm({ editing: it });
    if (action === "delete") setRemoving(it);
  };
  const header = (col: Column) => (
    <ColumnHeader
      col={col}
      features={inColumn(col.target)}
      onStart={() => col.iteration && setStarting(col.iteration)}
      onFinish={() => col.iteration && setFinishing(col.iteration)}
      onMenu={(anchor) => col.iteration && setMenu({ anchor, kind: "iteration", id: col.iteration.id })}
    />
  );
  const aiWas = (f: Feature) => aiMovedFrom(f, iterations);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header ref={headerRef} className="flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b border-stroke px-4">
        <h1 className="shrink-0 text-[13px] font-medium text-content">{t("view.cycles")}</h1>
        {fits.count ? <span className="min-w-0 truncate text-[12px] text-content/40">{t("iterations.counts", { iterations: iterations.length, features: features.length })}</span> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <label className="relative flex h-7 items-center">
            <Search className="pointer-events-none absolute left-2 size-3 text-content/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("iterations.search")} className={`h-7 rounded-md bg-content/5 pl-6 pr-2 text-[12px] text-content outline-none placeholder:text-content/40 ${fits.backbones ? "w-44" : "w-28"}`} />
          </label>
          {fits.backbones ? (
            <button
              type="button"
              onClick={(e) => setMenu({ anchor: e.currentTarget, kind: "backbones" })}
              className={`flex h-7 items-center gap-1 rounded-md px-2 text-[12px] ${backbones.size ? "bg-selection text-content" : "text-content/60 hover:bg-content/10 hover:text-content"}`}
            >
              <ListFilter className="size-3.5" />
              {backbones.size ? `${t("iterations.backbones")} · ${backbones.size}` : t("iterations.allBackbones")}
            </button>
          ) : null}
          {fits.layout ? (
            <div className="flex rounded-md bg-content/5 p-0.5">
              {(["board", "list"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={layout === l} onClick={() => setLayout(l)} className={`h-6 rounded px-2 text-[12px] ${layout === l ? "bg-selection text-content" : "text-content/60 hover:text-content"}`}>
                  {t(`iterations.layout.${l}`)}
                </button>
              ))}
            </div>
          ) : null}
          {fits.newFeature ? (
            <button type="button" onClick={() => setNewFeature("pending")} className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-content/70 hover:bg-content/10 hover:text-content">
              <Plus className="size-3.5" />
              {t("iterations.newFeature.action")}
            </button>
          ) : null}
          <button type="button" onClick={() => setForm({})} className="flex h-7 items-center gap-1 rounded-md bg-content/10 px-2 text-[12px] text-content hover:bg-content/15">
            <Plus className="size-3.5" />
            {t("iterations.newIteration")}
          </button>
          {allFit ? null : (
            <button
              type="button"
              aria-label={t("iterations.more")}
              onClick={(e) => setMenu({ anchor: e.currentTarget, kind: "toolbar" })}
              className={`grid size-7 place-items-center rounded-md hover:bg-content/10 hover:text-content ${backbones.size && !fits.backbones ? "bg-selection text-content" : "text-content/60"}`}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          )}
        </div>
      </header>
      {notice ? <NoticeBar notice={notice} onUndo={(batch) => void undo(batch)} onClose={() => setNotice(null)} /> : null}
      {!iterations.length && features.length ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-stroke bg-accent/5 px-4 py-2 text-[12px] text-content/70">
          <span className="min-w-0 line-clamp-2">{t("iterations.empty.generateHint", { count: features.length })}</span>
          <button
            type="button"
            onClick={() => void actBatch(t("iterations.notice.generated"), "generateIterations", project.id).catch((e: unknown) => setNotice({ kind: "error", message: errorText(e) }))}
            className="ml-auto shrink-0 whitespace-nowrap rounded-md bg-content px-2.5 py-1 font-medium text-background-base hover:bg-content/80"
          >
            {t("iterations.empty.generate")}
          </button>
        </div>
      ) : null}
      {!features.length ? (
        <div className="shrink-0 border-b border-stroke px-4 py-2 text-[12px] text-content/60">{t("iterations.empty.noFeatures")}</div>
      ) : null}
      {overcut.length ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke bg-amber-400/5 px-4 py-1.5 text-[12px] text-amber-300">
          <span className="min-w-0 truncate" title={t("iterations.overcut", { count: overcut.length })}>{t("iterations.overcut", { count: overcut.length })}</span>
          <button type="button" onClick={() => setShowOvercut(!showOvercut)} className="ml-auto shrink-0 whitespace-nowrap rounded px-2 py-0.5 hover:bg-amber-400/10">
            {showOvercut ? t("iterations.hide") : t("iterations.show")}
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {layout === "board" ? (
          <Board
            columns={columns}
            byColumn={byColumn}
            aiWas={aiWas}
            selected={selected}
            onSelect={setSelected}
            header={header}
            backboneLabel={backboneLabel}
            onAdd={() => setForm({})}
            onDropFeature={(id, target) => {
              const f = features.find((x) => x.id === id);
              if (f) moveFeature(f, target);
            }}
            onDropIteration={(id, beforeId) => void act("moveIteration", id, beforeId)}
          />
        ) : (
          <List columns={columns} byColumn={byColumn} aiWas={aiWas} selected={selected} onSelect={setSelected} header={header} backboneLabel={backboneLabel} onMove={(anchor, id) => setMenu({ anchor, kind: "move", id })} />
        )}
        {feature ? (
          <Detail
            key={feature.id}
            feature={feature}
            iterations={iterations}
            backboneLabel={backboneLabel}
            onMove={(target) => moveFeature(feature, target)}
            onRename={(name) => void act("renameFeature", feature.id, name)}
            onCreateIssue={() => void act("createFeatureIssue", feature.id)}
            onOpenIssue={() =>
              feature.issue_id &&
              // 标签名取 path 的 basename，不能含 /
              openProjectView({ cwd, view: "issue", itemId: String(feature.issue_id), title: `${feature.issue_ident} ${feature.name}`.replace(/\//g, "∕") })
            }
            onDelete={() => {
              setSelected(null);
              void actBatch(t("iterations.notice.featureDeleted", { name: feature.name }), "deleteFeature", feature.id).catch((e: unknown) => setNotice({ kind: "error", message: errorText(e) }));
            }}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>

      {menu?.kind === "iteration" && byId.has(menu.id) ? (
        <ExplorerMenu anchor={menu.anchor} items={iterationMenu(menu.id)} ariaLabel={t("iterations.actions")} width={180} onPick={(action) => { setMenu(null); onIterationMenu(menu.id, action); }} onClose={() => setMenu(null)} />
      ) : null}
      {menu?.kind === "move" ? (() => {
        const f = features.find((x) => x.id === menu.id);
        if (!f) return null;
        return (
          <ExplorerMenu
            anchor={menu.anchor}
            items={columns.map((c) => ({ kind: "item" as const, id: encodeTarget(c.target), label: columnLabel(c), checked: targetOf(f) === c.target, disabled: c.iteration?.status === "done" }))}
            ariaLabel={t("iterations.moveTo")}
            width={200}
            onPick={(value) => {
              setMenu(null);
              const col = columns.find((c) => encodeTarget(c.target) === value);
              if (col) moveFeature(f, col.target);
            }}
            onClose={() => setMenu(null)}
          />
        );
      })() : null}
      {menu?.kind === "toolbar" ? (
        <ExplorerMenu
          anchor={menu.anchor}
          ariaLabel={t("iterations.more")}
          width={200}
          items={[
            ...(fits.layout ? [] : (["board", "list"] as const).map((l) => ({ kind: "item" as const, id: `layout:${l}`, label: t(`iterations.layout.${l}`), checked: layout === l }))),
            ...(fits.backbones ? [] : [{ kind: "item" as const, id: "backbones", label: backbones.size ? `${t("iterations.backbones")} · ${backbones.size}` : t("iterations.allBackbones") }]),
            ...(fits.newFeature ? [] : [{ kind: "item" as const, id: "newFeature", label: t("iterations.newFeature.action") }]),
          ]}
          onPick={(id) => {
            const anchor = menu.anchor;
            setMenu(null);
            if (id.startsWith("layout:")) setLayout(id.slice(7) as Layout);
            // 骨干是多选：在同一个位置接着打开骨干菜单
            if (id === "backbones") setMenu({ anchor, kind: "backbones" });
            if (id === "newFeature") setNewFeature("pending");
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu?.kind === "backbones" ? (
        <ExplorerMenu
          anchor={menu.anchor}
          items={[...new Set(features.map((f) => f.backbone ?? NO_BACKBONE))].sort().map((id) => ({ kind: "item" as const, id, label: backboneLabel(id), checked: backbones.has(id) }))}
          ariaLabel={t("iterations.backbones")}
          width={240}
          onPick={(id) => setBackbones((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {form ? (
        <IterationFormDialog
          iterations={iterations}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSubmit={async (input, beforeId) => {
            if (form.editing) await mutateSoloyard("updateIteration", form.editing.id, input);
            else await mutateSoloyard("createIteration", project.id, input, beforeId);
            setForm(null);
          }}
        />
      ) : null}
      {removing ? (() => {
        const inIt = inColumn(removing.id);
        return (
          <DeleteIterationDialog
            iteration={removing}
            iterations={iterations}
            featureCount={inIt.length}
            issueCount={inIt.filter((f) => f.issue_id).length}
            onClose={() => setRemoving(null)}
            onDelete={async (moveTo) => {
              await actBatch(
                inIt.length
                  ? t("iterations.remove.doneMoved", { iteration: iterationLabel(removing), count: inIt.length, target: targetLabel(moveTo) })
                  : t("iterations.remove.doneEmpty", { iteration: iterationLabel(removing) }),
                "deleteIteration", removing.id, moveTo,
              );
              setRemoving(null);
            }}
          />
        );
      })() : null}
      {starting ? (
        <StartIterationDialog
          iteration={starting}
          features={inColumn(starting.id)}
          activeOther={iterations.find((i) => i.status === "active" && i.id !== starting.id)}
          onClose={() => setStarting(null)}
          onStart={async (ids) => {
            await actBatch(t("iterations.notice.started", { iteration: iterationLabel(starting), count: ids.length }), "startIteration", starting.id, ids);
            setStarting(null);
          }}
        />
      ) : null}
      {finishing ? (() => {
        const inIt = inColumn(finishing.id);
        const leftovers = inIt.filter(unfinished);
        return (
          <FinishIterationDialog
            iteration={finishing}
            iterations={iterations}
            done={inIt.length - leftovers.length}
            leftovers={leftovers}
            onClose={() => setFinishing(null)}
            onFinish={async (moves) => {
              await actBatch(t("iterations.notice.finished", { iteration: iterationLabel(finishing), count: leftovers.length }), "finishIteration", finishing.id, moves);
              setFinishing(null);
            }}
          />
        );
      })() : null}
      {newFeature != null ? (
        <NewFeatureDialog
          iterations={iterations}
          initialTarget={newFeature}
          onClose={() => setNewFeature(null)}
          onCreate={async (name, target) => {
            const id = await mutateSoloyard<number>("createFeature", project.id, { name }, target);
            setNewFeature(null);
            setSelected(id);
          }}
        />
      ) : null}
    </div>
  );
}

function ColumnHeader({ col, features, onStart, onFinish, onMenu }: { col: Column; features: Feature[]; onStart: () => void; onFinish: () => void; onMenu: (anchor: HTMLElement) => void }) {
  const { t } = useTranslation("soloyard");
  const it = col.iteration;
  const withIssue = features.filter((f) => f.issue_id);
  const done = withIssue.filter((f) => f.issue_status === "done").length;
  const actionButton = "mt-1 self-start rounded-md border border-stroke px-2 py-0.5 text-[11px] text-content/70 hover:bg-content/10 hover:text-content";
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        {it ? <span className="rounded bg-content/10 px-1.5 font-mono text-[12px] text-content">{it.tag}</span> : null}
        <span className="truncate font-medium text-content">{it ? it.name : columnLabel(col)}</span>
        <span className="text-[12px] text-content/40">{features.length}</span>
        {it ? (
          <>
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${it.status === "active" ? "bg-amber-400/15 text-amber-300" : it.status === "done" ? "bg-accent/15 text-accent" : "bg-content/5 text-content/50"}`}>
              {t(`iterations.status.${it.status}`)}
            </span>
            <button type="button" aria-label={t("iterations.actions")} onClick={(e) => onMenu(e.currentTarget)} className="rounded p-0.5 text-content/40 hover:bg-content/10 hover:text-content">
              <MoreHorizontal className="size-3.5" />
            </button>
          </>
        ) : null}
      </div>
      {it ? (
        <>
          {it.goal ? <p className="line-clamp-2 text-[11px] text-content/50">{it.goal}</p> : null}
          {it.target_date ? <p className="text-[11px] text-content/40">{t("iterations.target", { date: it.target_date })}</p> : null}
        </>
      ) : (
        <p className="line-clamp-2 text-[11px] text-content/50">{t(`iterations.bucketGoal.${col.kind as "pending" | "split" | "cut"}`)}</p>
      )}
      {it?.summary ? (
        <p className="text-[11px] text-content/50">{t("iterations.summary", { done: it.summary.done, moved: it.summary.moved })}</p>
      ) : it && withIssue.length ? (
        <div className="flex items-center gap-2 text-[11px] text-content/50">
          <div className="h-1 flex-1 overflow-hidden rounded bg-content/10">
            <div className="h-full bg-accent" style={{ width: `${(done / withIssue.length) * 100}%` }} />
          </div>
          {t("iterations.issuesProgress", { done, total: withIssue.length })}
        </div>
      ) : null}
      {it?.status === "planned" && features.length ? <button type="button" onClick={onStart} className={actionButton}>{t("iterations.start")}</button> : null}
      {it?.status === "active" ? <button type="button" onClick={onFinish} className={actionButton}>{t("iterations.finish")}</button> : null}
    </div>
  );
}

type ViewProps = {
  columns: Column[];
  byColumn: Map<string, Feature[]>;
  aiWas: (f: Feature) => string | null;
  selected: number | null;
  onSelect: (id: number) => void;
  header: (col: Column) => React.ReactNode;
  backboneLabel: (bb: string) => string;
};

/** 组展开状态：默认只展开前两个迭代，其余（含特殊列）折叠，免得一屏几百张卡；点过的组和默认相反。 */
function useGroups(columns: Column[]) {
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const defaultOpen = (target: Target) => {
    const index = columns.findIndex((c) => c.target === target);
    return columns[index]?.kind === "release" && index < 2;
  };
  const key = (target: Target, group: string) => `${encodeTarget(target)}:${group}`;
  const isOpen = (target: Target, group: string) => defaultOpen(target) !== toggled.has(key(target, group));
  const toggle = (target: Target, group: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key(target, group))) next.delete(key(target, group));
      else next.add(key(target, group));
      return next;
    });
  return { isOpen, toggle };
}

const groupByBackbone = (features: Feature[]) => {
  const map = new Map<string, Feature[]>();
  for (const f of features) map.set(f.backbone ?? NO_BACKBONE, [...(map.get(f.backbone ?? NO_BACKBONE) ?? []), f]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
};

function Board({ columns, byColumn, aiWas, selected, onSelect, header, backboneLabel, onAdd, onDropFeature, onDropIteration }: ViewProps & {
  onAdd: () => void;
  onDropFeature: (id: number, target: Target) => void;
  onDropIteration: (id: number, beforeId: number) => void;
}) {
  const { t } = useTranslation("soloyard");
  const { isOpen, toggle } = useGroups(columns);
  const [over, setOver] = useState<string | null>(null);
  const firstBucket = columns.findIndex((c) => c.kind !== "release");
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-none p-3">
      {columns.map((col, index) => {
        const key = encodeTarget(col.target);
        const features = byColumn.get(key) ?? [];
        const locked = col.iteration?.status === "done";
        const release = col.kind === "release";
        return [
          // 「新建迭代」列放在最后一个迭代后面、特殊列前面（新建默认排最后）
          index === firstBucket ? (
            <button key="add" type="button" onClick={onAdd} className="flex w-44 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-stroke text-[12px] text-content/45 hover:border-content/25 hover:text-content">
              <Plus className="size-4" />
              {t("iterations.newIteration")}
            </button>
          ) : null,
          <section
            key={key}
            onDragOver={(e) => {
              // 已完成的迭代锁定：不接功能，但还能参与排序；特殊列不参与排序
              if (locked && e.dataTransfer.types.includes(FEATURE_DRAG)) return;
              if (!release && e.dataTransfer.types.includes(ITERATION_DRAG)) return;
              e.preventDefault();
              setOver(key);
            }}
            onDragLeave={() => setOver((k) => (k === key ? null : k))}
            onDrop={(e) => {
              setOver(null);
              const featureId = e.dataTransfer.getData(FEATURE_DRAG);
              const iterationId = e.dataTransfer.getData(ITERATION_DRAG);
              if (featureId) onDropFeature(Number(featureId), col.target);
              else if (iterationId && col.iteration && Number(iterationId) !== col.iteration.id) onDropIteration(Number(iterationId), col.iteration.id);
            }}
            className={`flex w-72 shrink-0 flex-col rounded-lg ${release ? "bg-content/5" : "border border-dashed border-stroke"} ${over === key ? "ring-1 ring-accent/60" : ""}`}
          >
            <div draggable={release} onDragStart={(e) => col.iteration && e.dataTransfer.setData(ITERATION_DRAG, String(col.iteration.id))} className={release ? "cursor-grab" : ""}>
              {header(col)}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
              {!features.length ? <p className="rounded-md border border-dashed border-stroke px-3 py-6 text-center text-[11px] text-content/40">{locked ? t("iterations.lockedEmpty") : t("iterations.drop")}</p> : null}
              {groupByBackbone(features).map(([bb, list]) => {
                const open = isOpen(col.target, bb);
                return (
                  <div key={bb}>
                    <button type="button" onClick={() => toggle(col.target, bb)} className="flex h-6 w-full items-center gap-1 px-1 text-[11px] text-content/50 hover:text-content">
                      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      <span className="truncate">{backboneLabel(bb)}</span>
                      <span className="ml-auto">{list.length}</span>
                    </button>
                    {open ? (
                      <div className="flex flex-col gap-1">
                        {list.map((f) => <Card key={f.id} f={f} aiWas={aiWas(f)} selected={selected === f.id} locked={locked} onSelect={onSelect} />)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>,
        ];
      })}
    </div>
  );
}

function Card({ f, aiWas, selected, locked, onSelect }: { f: Feature; aiWas: string | null; selected: boolean; locked: boolean; onSelect: (id: number) => void }) {
  const { t } = useTranslation("soloyard");
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!locked}
      onDragStart={(e) => e.dataTransfer.setData(FEATURE_DRAG, String(f.id))}
      onClick={() => onSelect(f.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(f.id)}
      className={`flex cursor-default flex-col gap-1 rounded-md border bg-background-base px-2.5 py-2 text-[12px] ${selected ? "border-accent/60" : "border-stroke hover:border-content/20"}`}
    >
      <div className="flex items-start gap-1.5">
        {f.issue_status ? <StatusIcon status={f.issue_status} className="mt-0.5" /> : null}
        <span className="line-clamp-2 text-content/90">{f.name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-content/45">
        <span className="font-mono">{f.code}</span>
        {f.level ? <span className={`rounded px-1 ${ESSENTIAL.has(f.level) ? "bg-sky-400/15 text-sky-300" : "bg-content/5"}`}>{f.level}</span> : null}
        {f.prevalence ? <span title={t("iterations.coverage", { coverage: f.prevalence })}>{f.prevalence}</span> : null}
        {aiWas ? <span className="rounded bg-amber-400/10 px-1 text-amber-300" title={t("iterations.aiWasHint", { version: aiWas })}>{t("iterations.aiWas", { version: aiWas })}</span> : null}
        {f.issue_ident ? <span className="ml-auto font-mono">{f.issue_ident}</span> : null}
      </div>
    </div>
  );
}

function List({ columns, byColumn, aiWas, selected, onSelect, header, backboneLabel, onMove }: ViewProps & { onMove: (anchor: HTMLElement, id: number) => void }) {
  const { t } = useTranslation("soloyard");
  const { isOpen, toggle } = useGroups(columns);
  return (
    // 窄的时候次要列按宽度依次隐藏（骨干 → AI 原安排 → 普及层级 → 覆盖），功能名始终可见，不出横向滚动
    <div className="@container/list min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-none">
      {columns.map((col) => {
        const features = byColumn.get(encodeTarget(col.target)) ?? [];
        const open = isOpen(col.target, "*");
        const locked = col.iteration?.status === "done";
        return (
          <section key={encodeTarget(col.target)} className="border-b border-stroke">
            <div className={`sticky top-0 z-10 flex items-start gap-1 bg-background-base ${col.kind !== "release" ? "opacity-80" : ""}`}>
              <button type="button" aria-expanded={open} onClick={() => toggle(col.target, "*")} className="mt-2.5 pl-3 text-content/40 hover:text-content">
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
              <div className="min-w-0 flex-1">{header(col)}</div>
            </div>
            {open
              ? features.map((f) => {
                  const was = aiWas(f);
                  return (
                    <div key={f.id} role="button" tabIndex={0} onClick={() => onSelect(f.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(f.id)}
                      className={`flex h-8 cursor-default items-center gap-3 px-4 text-[12px] hover:bg-content/5 @2xl/list:px-8 ${selected === f.id ? "bg-content/5" : ""}`}>
                      <span className="w-20 shrink-0 font-mono text-[11px] text-content/40">{f.code}</span>
                      {f.issue_status ? <StatusIcon status={f.issue_status} /> : <span className="size-3.5 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate text-content/90">{f.name}</span>
                      <span className="hidden w-40 shrink-0 truncate text-[11px] text-content/40 @3xl/list:block">{backboneLabel(f.backbone ?? NO_BACKBONE)}</span>
                      <span className="hidden w-14 shrink-0 text-[11px] text-content/45 @xl/list:block">{f.level ?? ""}</span>
                      <span className="hidden w-10 shrink-0 text-[11px] text-content/45 @lg/list:block">{f.prevalence ?? ""}</span>
                      <span className="hidden w-20 shrink-0 truncate text-[11px] text-amber-300 @2xl/list:block">{was ? t("iterations.aiWas", { version: was }) : ""}</span>
                      {locked ? <span className="w-[42px] shrink-0" /> : (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onMove(e.currentTarget, f.id); }} className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-content/50 hover:bg-content/10 hover:text-content">
                          {t("iterations.moveTo")}
                        </button>
                      )}
                    </div>
                  );
                })
              : null}
          </section>
        );
      })}
    </div>
  );
}

function Detail({ feature: f, iterations, backboneLabel, onMove, onRename, onCreateIssue, onOpenIssue, onDelete, onClose }: {
  feature: Feature;
  iterations: Iteration[];
  backboneLabel: (bb: string) => string;
  onMove: (target: Target) => void;
  onRename: (name: string) => void;
  onCreateIssue: () => void;
  onOpenIssue: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const [name, setName] = useState(f.name);
  const columns = columnsOf(iterations);
  const where = targetOf(f);
  const isLocked = iterations.some((it) => it.id === where && it.status === "done");
  const saveName = () => {
    if (name.trim() && name.trim() !== f.name) onRename(name.trim());
    else setName(f.name);
  };
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-content/40">{label}</span>
        <div className="text-[12px] leading-relaxed text-content/80">{value}</div>
      </div>
    ) : null;
  return (
    <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-stroke p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-content/40">{f.code} · {backboneLabel(f.backbone ?? NO_BACKBONE)}</div>
          <input
            value={name}
            aria-label={t("iterations.newFeature.name")}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (isComposing(e)) return;
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(f.name);
                e.currentTarget.blur();
              }
            }}
            className="-mx-1 mt-1 w-full rounded px-1 text-[15px] font-medium text-content outline-none hover:bg-content/5 focus:bg-content/5"
          />
        </div>
        <button type="button" aria-label={t("iterations.close")} onClick={onClose} className="rounded p-1 text-content/40 hover:bg-content/10 hover:text-content">
          <X className="size-3.5" />
        </button>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-content/70">
        {t("iterations.moveTo")}
        <select
          value={encodeTarget(where)}
          disabled={isLocked}
          onChange={(e) => {
            const col = columns.find((c) => encodeTarget(c.target) === e.target.value);
            if (col) onMove(col.target);
          }}
          className="h-7 flex-1 rounded-md border border-stroke bg-background-base px-1.5 text-[12px] text-content disabled:opacity-50"
        >
          {columns.map((c) => <option key={encodeTarget(c.target)} value={encodeTarget(c.target)} disabled={c.iteration?.status === "done" && c.target !== where}>{columnLabel(c)}</option>)}
        </select>
      </label>
      {isLocked ? <p className="-mt-2 text-[11px] text-content/45">{t("iterations.lockedHint")}</p> : null}
      {row(t("iterations.aiPlan"), f.ai_plan ? planLabel(f.ai_plan) : null)}
      {row(t("iterations.reason"), f.reason)}
      {row(t("iterations.job"), f.job)}
      {row("Kano", f.kano)}
      {row(t("iterations.competitors"), f.prevalence ? t("iterations.coverage", { coverage: f.prevalence }) : null)}
      {row(t("iterations.evidence"), f.evidence.length ? <span className="flex flex-wrap gap-1">{f.evidence.map((e) => <span key={e} className="rounded bg-content/5 px-1.5 font-mono text-[11px]">{e}</span>)}</span> : null)}
      <div className="flex flex-col gap-1.5 border-t border-stroke pt-3">
        <span className="text-[11px] uppercase tracking-wide text-content/40">{t("iterations.issue")}</span>
        {f.issue_id && f.issue_status ? (
          <button type="button" onClick={onOpenIssue} className="flex items-center gap-2 self-start rounded px-1 py-0.5 text-[12px] text-content/80 hover:bg-content/10">
            <StatusIcon status={f.issue_status} />
            <span className="font-mono">{f.issue_ident}</span>
          </button>
        ) : typeof where !== "number" ? (
          <p className="text-[12px] text-content/50">{t("iterations.parkedIssue")}</p>
        ) : (
          <>
            <p className="text-[12px] text-content/50">{t("iterations.noIssue")}</p>
            <button type="button" onClick={onCreateIssue} className="self-start rounded-md bg-content/10 px-2.5 py-1 text-[12px] text-content hover:bg-content/15">
              {t("iterations.createIssue")}
            </button>
          </>
        )}
      </div>
      <button type="button" onClick={onDelete} className="mt-auto flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12px] text-red-400/80 hover:bg-red-500/10 hover:text-red-400">
        <Trash2 className="size-3.5" />
        {t("iterations.deleteFeature")}
      </button>
    </aside>
  );
}
