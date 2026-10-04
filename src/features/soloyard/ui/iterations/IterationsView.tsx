/**
 * 迭代（原型，mock 数据）：功能全景 = 一张带版本号的迭代表。
 * 每个版本一列，从左到右就是优先级；最后是「另立项」「不做」两个特殊列。
 * 减法 = 把功能拖到别的版本或「不做」；开始迭代 = 给这个版本的功能批量建 issue。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { ExplorerMenu, type ExplorerMenuItem } from "../../../files/ui/ExplorerMenu";
import { ChevronDown, ChevronRight, ListFilter, MoreHorizontal, Plus, Search, X } from "../../../../shared/ui/icons";
import { MOCK_BACKBONES, MOCK_FEATURES, type MockFeature, type MockIteration } from "../../mock/iterationsMock";
import { mockActions, releases, resetIterationsMock, unfinished, useIterationsMock, type IterationsState } from "../../mock/iterationsStore";
import { DeleteIterationDialog, FinishIterationDialog, IterationFormDialog, StartIterationDialog } from "./IterationDialogs";
import { StatusIcon } from "../issues/IssueIcons";

const FEATURE_DRAG = "application/x-soloyard-feature";
const ITERATION_DRAG = "application/x-soloyard-iteration";
const LAYOUT_KEY = "soloyard.iterationsLayout";
/** 「减过头」只看这两类：竞品普遍都有，砍掉或推得太后要提醒。 */
const ESSENTIAL = new Set(["必备", "常见"]);

type Layout = "board" | "list";
type Menu = { anchor: HTMLElement; kind: "iteration"; id: string } | { anchor: HTMLElement; kind: "backbones" } | { anchor: HTMLElement; kind: "move"; code: string };

export function IterationsView() {
  const { t } = useTranslation("soloyard");
  const store = useIterationsMock();
  const [layout, setLayoutState] = useState<Layout>(() => (localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "board"));
  const [backbones, setBackbones] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [confirmStart, setConfirmStart] = useState<MockIteration | null>(null);
  const [finishing, setFinishing] = useState<MockIteration | null>(null);
  const [showOvercut, setShowOvercut] = useState(false);
  /** null = 不显示；editing 为空 = 新建。 */
  const [form, setForm] = useState<{ editing?: MockIteration } | null>(null);
  const [removing, setRemoving] = useState<MockIteration | null>(null);
  /** 删除后顶部的「撤销」：存删除前后的整份状态；删完又改过别的（store 不再是 next）就不再提供撤销，免得把后来的改动一起撤掉。 */
  const [undo, setUndo] = useState<{ prev: IterationsState; next: IterationsState; message: string } | null>(null);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    localStorage.setItem(LAYOUT_KEY, next);
  };

  const releaseIds = releases(store).map((i) => i.id);
  const overcut = MOCK_FEATURES.filter((f) => {
    if (!f.level || !ESSENTIAL.has(f.level)) return false;
    const where = store.placement[f.code];
    return releaseIds.indexOf(where) < 0 || releaseIds.indexOf(where) >= 2;
  });
  const visible = MOCK_FEATURES.filter(
    (f) =>
      (!backbones.size || backbones.has(f.backbone)) &&
      (!q.trim() || `${f.code} ${f.name}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      (!showOvercut || overcut.includes(f)),
  );
  const byIteration = useMemo(() => {
    const map = new Map<string, MockFeature[]>(store.iterations.map((i) => [i.id, []]));
    for (const f of visible) map.get(store.placement[f.code])?.push(f);
    return map;
  }, [visible, store]);
  const versionLabel = (id: string) => {
    const it = store.iterations.find((i) => i.id === id);
    return it ? (it.version || it.name) : id;
  };
  const feature = selected ? MOCK_FEATURES.find((f) => f.code === selected) : undefined;

  const iterationMenu = (id: string): ExplorerMenuItem[] => {
    const it = store.iterations.find((i) => i.id === id)!;
    const index = releaseIds.indexOf(id);
    return [
      ...(it.status === "planned" ? [{ kind: "item" as const, id: "start", label: t("iterations.start") }] : []),
      ...(it.status === "active" ? [{ kind: "item" as const, id: "finish", label: t("iterations.finish") }] : []),
      ...(it.status === "done" ? [{ kind: "item" as const, id: "reopen", label: t("iterations.reopen") }] : []),
      { kind: "item", id: "earlier", label: t("iterations.earlier"), disabled: index <= 0 },
      { kind: "item", id: "later", label: t("iterations.later"), disabled: index < 0 || index >= releaseIds.length - 1 },
      { kind: "item", id: "edit", label: t("iterations.edit") },
      { kind: "sep" },
      { kind: "item", id: "delete", label: t("iterations.remove.action"), danger: true },
    ];
  };
  const onIterationMenu = (id: string, action: string) => {
    const index = releaseIds.indexOf(id);
    if (action === "start") setConfirmStart(store.iterations.find((i) => i.id === id)!);
    if (action === "finish") setFinishing(store.iterations.find((i) => i.id === id) ?? null);
    if (action === "reopen") mockActions.reopen(id);
    if (action === "earlier") mockActions.reorder(id, releaseIds[index - 1]);
    if (action === "later") mockActions.reorder(id, releaseIds[index + 2] ?? null);
    if (action === "edit") setForm({ editing: store.iterations.find((i) => i.id === id) });
    if (action === "delete") setRemoving(store.iterations.find((i) => i.id === id) ?? null);
  };
  const header = (it: MockIteration) => (
    <IterationHeader
      it={it}
      features={MOCK_FEATURES.filter((f) => store.placement[f.code] === it.id)}
      issues={store.issues}
      onStart={() => setConfirmStart(it)}
      onFinish={() => setFinishing(it)}
      onMenu={(anchor) => setMenu({ anchor, kind: "iteration", id: it.id })}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-stroke px-4">
        <h1 className="text-[13px] font-medium text-content">{t("view.cycles")}</h1>
        <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] text-amber-300">{t("iterations.prototype")}</span>
        <div className="ml-auto flex items-center gap-1">
          <label className="relative flex h-7 items-center">
            <Search className="pointer-events-none absolute left-2 size-3 text-content/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("iterations.search")} className="h-7 w-44 rounded-md bg-content/5 pl-6 pr-2 text-[12px] text-content outline-none placeholder:text-content/40" />
          </label>
          <button
            type="button"
            onClick={(e) => setMenu({ anchor: e.currentTarget, kind: "backbones" })}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[12px] ${backbones.size ? "bg-selection text-content" : "text-content/60 hover:bg-content/10 hover:text-content"}`}
          >
            <ListFilter className="size-3.5" />
            {backbones.size ? `${t("iterations.backbones")} · ${backbones.size}` : t("iterations.allBackbones")}
          </button>
          <div className="flex rounded-md bg-content/5 p-0.5">
            {(["board", "list"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={layout === l} onClick={() => setLayout(l)} className={`h-6 rounded px-2 text-[12px] ${layout === l ? "bg-selection text-content" : "text-content/60 hover:text-content"}`}>
                {t(`iterations.layout.${l}`)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setForm({})} className="flex h-7 items-center gap-1 rounded-md bg-content/10 px-2 text-[12px] text-content hover:bg-content/15">
            <Plus className="size-3.5" />
            {t("iterations.newIteration")}
          </button>
          <button type="button" onClick={resetIterationsMock} className="h-7 rounded-md px-2 text-[12px] text-content/50 hover:text-content">
            {t("iterations.reset")}
          </button>
        </div>
      </header>
      {undo?.next === store ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke bg-content/5 px-4 py-1.5 text-[12px] text-content/70">
          {undo.message}
          <button type="button" onClick={() => { mockActions.restore(undo.prev); setUndo(null); }} className="ml-auto rounded px-2 py-0.5 font-medium text-content hover:bg-content/10">
            {t("iterations.undo")}
          </button>
          <button type="button" aria-label={t("iterations.close")} onClick={() => setUndo(null)} className="rounded p-0.5 text-content/40 hover:bg-content/10 hover:text-content">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {overcut.length ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke bg-amber-400/5 px-4 py-1.5 text-[12px] text-amber-300">
          {t("iterations.overcut", { count: overcut.length })}
          <button type="button" onClick={() => setShowOvercut(!showOvercut)} className="ml-auto rounded px-2 py-0.5 hover:bg-amber-400/10">
            {showOvercut ? t("iterations.hide") : t("iterations.show")}
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {layout === "board" ? (
          <Board iterations={store.iterations} byIteration={byIteration} placementAi={(f) => f.ai !== store.placement[f.code] ? versionLabel(f.ai) : null} issues={store.issues} selected={selected} onSelect={setSelected} header={header} onAdd={() => setForm({})} />
        ) : (
          <List iterations={store.iterations} byIteration={byIteration} placementAi={(f) => f.ai !== store.placement[f.code] ? versionLabel(f.ai) : null} issues={store.issues} selected={selected} onSelect={setSelected} header={header} onMove={(anchor, code) => setMenu({ anchor, kind: "move", code })} />
        )}
        {feature ? (
          <Detail
            feature={feature}
            where={store.placement[feature.code]}
            aiLabel={versionLabel(feature.ai)}
            issue={store.issues[feature.code]}
            iterations={store.iterations}
            onMove={(id) => mockActions.move(feature.code, id)}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>

      {menu?.kind === "iteration" ? (
        <ExplorerMenu anchor={menu.anchor} items={iterationMenu(menu.id)} ariaLabel={t("iterations.actions")} width={180} onPick={(action) => { setMenu(null); onIterationMenu(menu.id, action); }} onClose={() => setMenu(null)} />
      ) : null}
      {menu?.kind === "move" ? (
        <ExplorerMenu
          anchor={menu.anchor}
          items={store.iterations.map((it) => ({ kind: "item" as const, id: it.id, label: [it.version, it.name].filter(Boolean).join(" · ") || t("iterations.untitled"), checked: store.placement[menu.code] === it.id, disabled: it.status === "done" }))}
          ariaLabel={t("iterations.moveTo")}
          width={200}
          onPick={(id) => { setMenu(null); mockActions.move(menu.code, id); }}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu?.kind === "backbones" ? (
        <ExplorerMenu
          anchor={menu.anchor}
          items={Object.entries(MOCK_BACKBONES).map(([id, name]) => ({ kind: "item" as const, id, label: `${id} ${name}`, checked: backbones.has(id) }))}
          ariaLabel={t("iterations.backbones")}
          width={240}
          onPick={(id) => setBackbones((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {form ? (
        <IterationFormDialog
          iterations={store.iterations}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSubmit={(input, beforeId) => {
            if (form.editing) mockActions.update(form.editing.id, input);
            else mockActions.add(input, beforeId);
            setForm(null);
          }}
        />
      ) : null}
      {removing ? (() => {
        const codes = MOCK_FEATURES.filter((f) => store.placement[f.code] === removing.id).map((f) => f.code);
        const label = [removing.version, removing.name].filter(Boolean).join(" · ");
        return (
          <DeleteIterationDialog
            iteration={removing}
            iterations={store.iterations}
            featureCount={codes.length}
            issueCount={codes.filter((c) => store.issues[c]).length}
            onClose={() => setRemoving(null)}
            onDelete={(moveTo) => {
              setUndo({
                ...mockActions.remove(removing.id, moveTo),
                message: codes.length
                  ? t("iterations.remove.doneMoved", { iteration: label, count: codes.length, target: versionLabel(moveTo) })
                  : t("iterations.remove.doneEmpty", { iteration: label }),
              });
              setRemoving(null);
            }}
          />
        );
      })() : null}
      {confirmStart ? (
        <StartIterationDialog
          iteration={confirmStart}
          features={MOCK_FEATURES.filter((f) => store.placement[f.code] === confirmStart.id)}
          issueOf={(code) => store.issues[code]}
          activeOther={store.iterations.find((i) => i.status === "active" && i.id !== confirmStart.id)}
          onClose={() => setConfirmStart(null)}
          onStart={(codes) => { mockActions.start(confirmStart.id, codes); setConfirmStart(null); }}
        />
      ) : null}
      {finishing ? (() => {
        const inIt = MOCK_FEATURES.filter((f) => store.placement[f.code] === finishing.id);
        const leftovers = inIt.filter((f) => unfinished(store, f.code));
        return (
          <FinishIterationDialog
            iteration={finishing}
            iterations={store.iterations}
            done={inIt.length - leftovers.length}
            leftovers={leftovers}
            issueOf={(code) => store.issues[code]}
            onClose={() => setFinishing(null)}
            onFinish={(moves) => { mockActions.finish(finishing.id, moves); setFinishing(null); }}
          />
        );
      })() : null}
    </div>
  );
}

type Issues = Record<string, { ident: string; status: import("../../model/issues").IssueStatus }>;

function IterationHeader({ it, features, issues, onStart, onFinish, onMenu }: { it: MockIteration; features: MockFeature[]; issues: Issues; onStart: () => void; onFinish: () => void; onMenu: (anchor: HTMLElement) => void }) {
  const { t } = useTranslation("soloyard");
  const withIssue = features.filter((f) => issues[f.code]);
  const done = withIssue.filter((f) => issues[f.code].status === "done").length;
  const release = it.kind === "release";
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        {it.version ? <span className="rounded bg-content/10 px-1.5 font-mono text-[12px] text-content">{it.version}</span> : null}
        <span className="truncate font-medium text-content">{it.name || t("iterations.untitled")}</span>
        <span className="text-[12px] text-content/40">{features.length}</span>
        {release ? (
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
      {it.goal ? <p className="line-clamp-2 text-[11px] text-content/50">{it.goal}</p> : null}
      {it.targetDate ? <p className="text-[11px] text-content/40">{t("iterations.target", { date: it.targetDate })}</p> : null}
      {it.summary ? (
        <p className="text-[11px] text-content/50">{t("iterations.summary", { done: it.summary.done, moved: it.summary.moved })}</p>
      ) : release && withIssue.length ? (
        <div className="flex items-center gap-2 text-[11px] text-content/50">
          <div className="h-1 flex-1 overflow-hidden rounded bg-content/10">
            <div className="h-full bg-accent" style={{ width: `${(done / withIssue.length) * 100}%` }} />
          </div>
          {t("iterations.issuesProgress", { done, total: withIssue.length })}
        </div>
      ) : null}
      {release && it.status === "planned" && features.length ? (
        <button type="button" onClick={onStart} className="mt-1 self-start rounded-md border border-stroke px-2 py-0.5 text-[11px] text-content/70 hover:bg-content/10 hover:text-content">
          {t("iterations.start")}
        </button>
      ) : null}
      {release && it.status === "active" ? (
        <button type="button" onClick={onFinish} className="mt-1 self-start rounded-md border border-stroke px-2 py-0.5 text-[11px] text-content/70 hover:bg-content/10 hover:text-content">
          {t("iterations.finish")}
        </button>
      ) : null}
    </div>
  );
}

type ViewProps = {
  iterations: MockIteration[];
  byIteration: Map<string, MockFeature[]>;
  placementAi: (f: MockFeature) => string | null;
  issues: Issues;
  selected: string | null;
  onSelect: (code: string) => void;
  header: (it: MockIteration) => React.ReactNode;
};

/** 按骨干分组；组可折叠，默认展开前两个版本，后面的折叠，免得一屏几百张卡。 */
function useGroups(iterations: MockIteration[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const later = iterations.filter((it, i) => it.kind !== "release" || i >= 2).map((it) => it.id);
    return new Set(later.flatMap((id) => Object.keys(MOCK_BACKBONES).map((bb) => `${id}:${bb}`)));
  });
  const toggle = (key: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return { collapsed, toggle };
}

const groupByBackbone = (features: MockFeature[]) => {
  const map = new Map<string, MockFeature[]>();
  for (const f of features) map.set(f.backbone, [...(map.get(f.backbone) ?? []), f]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
};

function Board({ iterations, byIteration, placementAi, issues, selected, onSelect, header, onAdd }: ViewProps & { onAdd: () => void }) {
  const { t } = useTranslation("soloyard");
  const { collapsed, toggle } = useGroups(iterations);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-none p-3">
      {iterations.map((it, index) => {
        const features = byIteration.get(it.id) ?? [];
        // 「新建迭代」列放在最后一个正常版本后面、特殊列前面（新建默认排最后）
        const addColumn = index === iterations.findIndex((i) => i.kind !== "release") ? (
          <button key="add" type="button" onClick={onAdd} className="flex w-44 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-stroke text-[12px] text-content/45 hover:border-content/25 hover:text-content">
            <Plus className="size-4" />
            {t("iterations.newIteration")}
          </button>
        ) : null;
        return [addColumn,
          <section
            key={it.id}
            onDragOver={(e) => {
              // 已完成的迭代锁定：不接功能，但还能参与版本排序
              if (it.status === "done" && e.dataTransfer.types.includes(FEATURE_DRAG)) return;
              e.preventDefault();
              setOver(it.id);
            }}
            onDragLeave={() => setOver((id) => (id === it.id ? null : id))}
            onDrop={(e) => {
              setOver(null);
              const code = e.dataTransfer.getData(FEATURE_DRAG);
              const iteration = e.dataTransfer.getData(ITERATION_DRAG);
              if (code) mockActions.move(code, it.id);
              else if (iteration && it.kind === "release" && iteration !== it.id) mockActions.reorder(iteration, it.id);
            }}
            className={`flex w-72 shrink-0 flex-col rounded-lg ${it.kind === "release" ? "bg-content/5" : "border border-dashed border-stroke"} ${over === it.id ? "ring-1 ring-accent/60" : ""}`}
          >
            <div draggable={it.kind === "release"} onDragStart={(e) => e.dataTransfer.setData(ITERATION_DRAG, it.id)} className={it.kind === "release" ? "cursor-grab" : ""}>
              {header(it)}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
              {!features.length ? <p className="rounded-md border border-dashed border-stroke px-3 py-6 text-center text-[11px] text-content/40">{t("iterations.drop")}</p> : null}
              {groupByBackbone(features).map(([bb, list]) => {
                const key = `${it.id}:${bb}`;
                const open = !collapsed.has(key);
                return (
                  <div key={bb}>
                    <button type="button" onClick={() => toggle(key)} className="flex h-6 w-full items-center gap-1 px-1 text-[11px] text-content/50 hover:text-content">
                      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      <span className="truncate">{bb} {MOCK_BACKBONES[bb]}</span>
                      <span className="ml-auto">{list.length}</span>
                    </button>
                    {open ? (
                      <div className="flex flex-col gap-1">
                        {list.map((f) => <Card key={f.code} f={f} aiWas={placementAi(f)} issue={issues[f.code]} selected={selected === f.code} locked={it.status === "done"} onSelect={onSelect} />)}
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

function Card({ f, aiWas, issue, selected, locked, onSelect }: { f: MockFeature; aiWas: string | null; issue?: Issues[string]; selected: boolean; locked: boolean; onSelect: (code: string) => void }) {
  const { t } = useTranslation("soloyard");
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!locked}
      onDragStart={(e) => e.dataTransfer.setData(FEATURE_DRAG, f.code)}
      onClick={() => onSelect(f.code)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(f.code)}
      className={`flex cursor-default flex-col gap-1 rounded-md border bg-background-base px-2.5 py-2 text-[12px] ${selected ? "border-accent/60" : "border-stroke hover:border-content/20"}`}
    >
      <div className="flex items-start gap-1.5">
        {issue ? <StatusIcon status={issue.status} className="mt-0.5" /> : null}
        <span className="line-clamp-2 text-content/90">{f.name}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-content/45">
        <span className="font-mono">{f.code}</span>
        {f.level ? <span className={`rounded px-1 ${ESSENTIAL.has(f.level) ? "bg-sky-400/15 text-sky-300" : "bg-content/5"}`}>{f.level}</span> : null}
        {f.total ? <span title={t("iterations.coverage", { covered: f.covered, total: f.total })}>{f.covered}/{f.total}</span> : null}
        {aiWas ? <span className="rounded bg-amber-400/10 px-1 text-amber-300" title={t("iterations.aiWasHint", { version: aiWas })}>{t("iterations.aiWas", { version: aiWas })}</span> : null}
        {issue ? <span className="ml-auto font-mono">{issue.ident}</span> : null}
      </div>
    </div>
  );
}

function List({ iterations, byIteration, placementAi, issues, selected, onSelect, header, onMove }: ViewProps & { onMove: (anchor: HTMLElement, code: string) => void }) {
  const { t } = useTranslation("soloyard");
  const { collapsed, toggle } = useGroups(iterations);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
      {iterations.map((it) => {
        const features = byIteration.get(it.id) ?? [];
        const open = !collapsed.has(`${it.id}:*`);
        return (
          <section key={it.id} className="border-b border-stroke">
            <div className={`sticky top-0 z-10 flex items-start gap-1 bg-background-base ${it.kind !== "release" ? "opacity-80" : ""}`}>
              <button type="button" aria-expanded={open} onClick={() => toggle(`${it.id}:*`)} className="mt-2.5 pl-3 text-content/40 hover:text-content">
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
              <div className="min-w-0 flex-1">{header(it)}</div>
            </div>
            {open
              ? features.map((f) => {
                  const issue = issues[f.code];
                  const aiWas = placementAi(f);
                  return (
                    <div key={f.code} role="button" tabIndex={0} onClick={() => onSelect(f.code)} onKeyDown={(e) => e.key === "Enter" && onSelect(f.code)}
                      className={`flex h-8 cursor-default items-center gap-3 px-8 text-[12px] hover:bg-content/5 ${selected === f.code ? "bg-content/5" : ""}`}>
                      <span className="w-20 shrink-0 font-mono text-[11px] text-content/40">{f.code}</span>
                      {issue ? <StatusIcon status={issue.status} /> : <span className="size-3.5 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate text-content/90">{f.name}</span>
                      <span className="w-40 shrink-0 truncate text-[11px] text-content/40">{MOCK_BACKBONES[f.backbone]}</span>
                      <span className="w-14 shrink-0 text-[11px] text-content/45">{f.level ?? ""}</span>
                      <span className="w-10 shrink-0 text-[11px] text-content/45">{f.total ? `${f.covered}/${f.total}` : ""}</span>
                      <span className="w-20 shrink-0 text-[11px] text-amber-300">{aiWas ? t("iterations.aiWas", { version: aiWas }) : ""}</span>
                      {it.status === "done" ? <span className="w-[42px] shrink-0" /> : (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onMove(e.currentTarget, f.code); }} className="rounded px-1.5 py-0.5 text-[11px] text-content/50 hover:bg-content/10 hover:text-content">
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

function Detail({ feature: f, where, aiLabel, issue, iterations, onMove, onClose }: { feature: MockFeature; where: string; aiLabel: string; issue?: Issues[string]; iterations: MockIteration[]; onMove: (id: string) => void; onClose: () => void }) {
  const { t } = useTranslation("soloyard");
  const isLocked = iterations.some((it) => it.id === where && it.status === "done");
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
          <div className="font-mono text-[11px] text-content/40">{f.code} · {f.backbone} {MOCK_BACKBONES[f.backbone]}</div>
          <h2 className="mt-1 text-[15px] font-medium text-content">{f.name}</h2>
        </div>
        <button type="button" aria-label={t("iterations.close")} onClick={onClose} className="rounded p-1 text-content/40 hover:bg-content/10 hover:text-content">
          <X className="size-3.5" />
        </button>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-content/70">
        {t("iterations.moveTo")}
        <select value={where} disabled={isLocked} onChange={(e) => onMove(e.target.value)} className="h-7 flex-1 rounded-md border border-stroke bg-background-base px-1.5 text-[12px] text-content disabled:opacity-50">
          {iterations.map((it) => <option key={it.id} value={it.id} disabled={it.status === "done" && it.id !== where}>{[it.version, it.name].filter(Boolean).join(" · ") || t("iterations.untitled")}</option>)}
        </select>
      </label>
      {isLocked ? <p className="-mt-2 text-[11px] text-content/45">{t("iterations.lockedHint")}</p> : null}
      {row(t("iterations.aiPlan"), aiLabel)}
      {row(t("iterations.reason"), f.reason)}
      {row(t("iterations.job"), f.job)}
      {row("Kano", f.kano)}
      {row(t("iterations.competitors"), f.total ? t("iterations.coverage", { covered: f.covered, total: f.total }) : null)}
      {row(t("iterations.evidence"), f.evidence.length ? <span className="flex flex-wrap gap-1">{f.evidence.map((e) => <span key={e} className="rounded bg-content/5 px-1.5 font-mono text-[11px]">{e}</span>)}</span> : null)}
      <div className="flex flex-col gap-1.5 border-t border-stroke pt-3">
        <span className="text-[11px] uppercase tracking-wide text-content/40">{t("iterations.issue")}</span>
        {issue ? (
          <span className="flex items-center gap-2 text-[12px] text-content/80"><StatusIcon status={issue.status} /> <span className="font-mono">{issue.ident}</span></span>
        ) : (
          <>
            <p className="text-[12px] text-content/50">{t("iterations.noIssue")}</p>
            <button type="button" onClick={() => mockActions.createIssue(f.code)} className="self-start rounded-md bg-content/10 px-2.5 py-1 text-[12px] text-content hover:bg-content/15">
              {t("iterations.createIssue")}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
