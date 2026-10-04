/**
 * 迭代页的弹窗：新建 / 编辑迭代、删除迭代、开始迭代、完成迭代、新建功能。
 * 提交都是异步的：提交中按钮禁用；数据层拒绝（版本号冲突、迭代已锁定……）时把原因显示在弹窗里，不关弹窗。
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "../../../../i18n";
import { Loader } from "../../../../shared/ui/icons";
import { Modal } from "../../../../shared/ui/Modal";
import {
  columnLabel,
  columnsOf,
  decodeTarget,
  encodeTarget,
  iterationLabel,
  suggestVersions,
  versionTaken,
  type Feature,
  type Iteration,
  type Target,
} from "../../model/iterations";
import { StatusIcon } from "../issues/IssueIcons";

const field = "rounded-md border border-content/10 bg-content/5 px-2.5 text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25";
/** 原生日期 / 下拉控件跟随应用主题（应用默认深色，浅色时根节点有 theme-light）。 */
const native = "[color-scheme:dark] [.theme-light_&]:[color-scheme:light]";
const labelText = "text-[12px] font-medium text-content/70";
const optional = "ml-1 font-normal text-content/35";
const cancelButton = "rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content";
const primaryButton = "inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40";

/** 提交状态：busy 期间禁用按钮，失败时留住弹窗并显示原因。 */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Footer({ busy, error, onClose, submitLabel, onSubmit, danger, disabled }: {
  busy: boolean; error: string | null; onClose: () => void; submitLabel: string; onSubmit?: () => void; danger?: boolean; disabled?: boolean;
}) {
  const { t } = useTranslation("soloyard");
  return (
    <>
      {error ? <p role="alert" className="text-[11px] leading-4 text-red-400/90">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={cancelButton}>{t("iterations.cancel")}</button>
        <button
          type={onSubmit ? "button" : "submit"}
          onClick={onSubmit}
          disabled={busy || disabled}
          className={danger ? "inline-flex items-center gap-1.5 rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-400 hover:bg-red-500/30 disabled:opacity-40" : primaryButton}
        >
          {busy ? <Loader className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
          {submitLabel}
        </button>
      </div>
    </>
  );
}

/** 功能能挪去的地方：除了 except 和已完成（锁定）的迭代。 */
const moveTargets = (iterations: Iteration[], except?: Target) =>
  columnsOf(iterations).filter((c) => c.target !== except && c.iteration?.status !== "done");
/** 从 from 开始第一个没完成的迭代。 */
const nextOpen = (list: Iteration[]) => list.find((i) => i.status !== "done")?.id;

export type IterationFormInput = { tag: string; name: string; goal: string; target_date: string | null };

/** editing 为空 = 新建（多一个「位置」）；否则编辑这个迭代。 */
export function IterationFormDialog({ iterations, editing, onSubmit, onClose }: {
  iterations: Iteration[];
  editing?: Iteration;
  onSubmit: (input: IterationFormInput, beforeId: number | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const suggested = suggestVersions(iterations);
  const [tag, setTag] = useState(editing?.tag ?? suggested.minor);
  const [name, setName] = useState(editing?.name ?? "");
  const [goal, setGoal] = useState(editing?.goal ?? "");
  const [targetDate, setTargetDate] = useState(editing?.target_date ?? "");
  const [beforeId, setBeforeId] = useState("");
  const tagInput = useRef<HTMLInputElement>(null);
  const submit = useSubmit();

  useEffect(() => {
    const frame = requestAnimationFrame(() => tagInput.current?.select());
    return () => cancelAnimationFrame(frame);
  }, []);

  const trimmed = tag.trim();
  const invalid = !trimmed ? t("iterations.form.versionRequired") : versionTaken(iterations, trimmed, editing?.id) ? t("iterations.form.versionTaken", { version: trimmed }) : null;
  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return tagInput.current?.focus();
    void submit.run(() => onSubmit({ tag: trimmed, name: name.trim(), goal: goal.trim(), target_date: targetDate || null }, beforeId ? Number(beforeId) : null));
  };

  return (
    <Modal title={editing ? t("iterations.form.editTitle") : t("iterations.form.newTitle")} size="sm" onClose={onClose}>
      <form className="flex flex-col gap-4 p-4" onSubmit={onFormSubmit}>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>{t("iterations.form.version")}</span>
          <input
            ref={tagInput}
            value={tag}
            maxLength={24}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!invalid}
            onChange={(e) => setTag(e.target.value)}
            className={`h-9 font-mono ${field} ${invalid ? "border-red-400/50" : ""}`}
          />
          <span className="flex items-center gap-1.5 text-[11px] text-content/45">
            {editing ? null : (
              <>
                {t("iterations.form.suggest")}
                {[suggested.minor, suggested.major].map((v) => (
                  <button key={v} type="button" onClick={() => setTag(v)} className={`rounded px-1.5 font-mono ${trimmed === v ? "bg-selection text-content" : "bg-content/5 hover:bg-content/10 hover:text-content"}`}>
                    {v}
                  </button>
                ))}
              </>
            )}
            {invalid ? <span role="alert" className="ml-auto text-red-400/90">{invalid}</span> : null}
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>
            {t("iterations.form.name")}
            <span className={optional}>{t("iterations.form.optional")}</span>
          </span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t("iterations.form.namePlaceholder")} className={`h-9 ${field}`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>
            {t("iterations.form.goal")}
            <span className={optional}>{t("iterations.form.optional")}</span>
          </span>
          <textarea value={goal} rows={2} maxLength={200} onChange={(e) => setGoal(e.target.value)} placeholder={t("iterations.form.goalPlaceholder")} className={`resize-none py-2 leading-snug ${field}`} />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={labelText}>
              {t("iterations.form.targetDate")}
              <span className={optional}>{t("iterations.form.optional")}</span>
            </span>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={`h-9 ${field} ${native}`} />
          </label>
          {editing || !iterations.length ? null : (
            <label className="flex flex-1 flex-col gap-1.5">
              <span className={labelText}>{t("iterations.form.position")}</span>
              <select value={beforeId} onChange={(e) => setBeforeId(e.target.value)} className={`h-9 ${field} ${native}`}>
                <option value="">{t("iterations.form.positionLast")}</option>
                {iterations.map((it) => (
                  <option key={it.id} value={it.id}>{t("iterations.form.positionBefore", { iteration: iterationLabel(it) })}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <Footer busy={submit.busy} error={submit.error} onClose={onClose} disabled={!!invalid} submitLabel={editing ? t("iterations.form.save") : t("iterations.form.create")} />
      </form>
    </Modal>
  );
}

/** 删除迭代：有功能时必须选去处（默认挪到后一个没完成的迭代，没有就前一个，再没有就「待定」）。 */
export function DeleteIterationDialog({ iteration, iterations, featureCount, issueCount, onDelete, onClose }: {
  iteration: Iteration;
  iterations: Iteration[];
  featureCount: number;
  issueCount: number;
  onDelete: (moveTo: Target) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const index = iterations.findIndex((i) => i.id === iteration.id);
  const targets = moveTargets(iterations, iteration.id);
  const [moveTo, setMoveTo] = useState<Target>(nextOpen(iterations.slice(index + 1)) ?? nextOpen(iterations.slice(0, index).reverse()) ?? "pending");
  const submit = useSubmit();

  return (
    <Modal title={t("iterations.remove.title", { iteration: iterationLabel(iteration) })} size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4 p-4 text-[12px] text-content/80">
        {iteration.status !== "planned" ? (
          <p className="rounded-md bg-amber-400/10 px-2.5 py-2 text-amber-300">{t(iteration.status === "active" ? "iterations.remove.active" : "iterations.remove.done")}</p>
        ) : null}
        {featureCount ? (
          <label className="flex flex-col gap-1.5">
            <span>{t("iterations.remove.moveFeatures", { count: featureCount })}</span>
            <select value={encodeTarget(moveTo)} onChange={(e) => setMoveTo(decodeTarget(e.target.value))} className={`h-9 ${field} ${native}`}>
              {targets.map((c) => <option key={encodeTarget(c.target)} value={encodeTarget(c.target)}>{columnLabel(c)}</option>)}
            </select>
            {issueCount ? <span className="text-[11px] text-content/45">{t("iterations.remove.issuesFollow", { count: issueCount })}</span> : null}
          </label>
        ) : (
          <p>{t("iterations.remove.empty")}</p>
        )}
        <Footer busy={submit.busy} error={submit.error} onClose={onClose} danger submitLabel={t("iterations.remove.confirm")} onSubmit={() => void submit.run(() => onDelete(moveTo))} />
      </div>
    </Modal>
  );
}

/** 开始迭代：默认给所有还没 issue 的功能建 issue，可以逐个取消；已有 issue 的不重复建。 */
export function StartIterationDialog({ iteration, features, activeOther, onStart, onClose }: {
  iteration: Iteration;
  features: Feature[];
  /** 另一个进行中的迭代（只提醒，不拦）。 */
  activeOther?: Iteration;
  onStart: (featureIds: number[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const fresh = features.filter((f) => !f.issue_id);
  const [picked, setPicked] = useState(() => new Set(fresh.map((f) => f.id)));
  const toggle = (id: number) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const all = picked.size === fresh.length;
  const submit = useSubmit();

  return (
    <Modal title={t("iterations.startDialog.title", { iteration: iterationLabel(iteration) })} size="md" fitViewport onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-3 p-4 text-[12px] text-content/80">
        {activeOther ? (
          <p className="rounded-md bg-amber-400/10 px-2.5 py-2 text-amber-300">{t("iterations.startDialog.activeOther", { iteration: iterationLabel(activeOther) })}</p>
        ) : null}
        {fresh.length ? (
          <>
            <div className="flex items-center gap-2">
              <span>{t("iterations.startDialog.pick", { count: fresh.length })}</span>
              <button type="button" onClick={() => setPicked(new Set(all ? [] : fresh.map((f) => f.id)))} className="ml-auto rounded px-1.5 py-0.5 text-content/60 hover:bg-content/10 hover:text-content">
                {all ? t("iterations.startDialog.none") : t("iterations.startDialog.all")}
              </button>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-content/10">
              {fresh.map((f) => (
                <li key={f.id}>
                  <label className="flex h-8 items-center gap-2 px-2.5 hover:bg-content/5">
                    <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} className="accent-accent" />
                    <span className="w-20 shrink-0 font-mono text-[11px] text-content/40">{f.code}</span>
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{t("iterations.startDialog.noneToCreate")}</p>
        )}
        {features.length > fresh.length ? <p className="text-[11px] text-content/45">{t("iterations.startDialog.existing", { count: features.length - fresh.length })}</p> : null}
        <p className="text-[11px] text-content/45">{t("iterations.startDialog.later")}</p>
        <Footer
          busy={submit.busy}
          error={submit.error}
          onClose={onClose}
          submitLabel={picked.size ? t("iterations.startDialog.confirm", { count: picked.size }) : t("iterations.start")}
          onSubmit={() => void submit.run(() => onStart([...picked]))}
        />
      </div>
    </Modal>
  );
}

/** 完成迭代：列出没做完的功能，默认挪到下一个没完成的迭代（没有就「待定」），可以统一改也可以逐个改。 */
export function FinishIterationDialog({ iteration, iterations, done, leftovers, onFinish, onClose }: {
  iteration: Iteration;
  iterations: Iteration[];
  done: number;
  leftovers: Feature[];
  onFinish: (moves: Record<string, Target>) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const targets = moveTargets(iterations, iteration.id);
  const index = iterations.findIndex((i) => i.id === iteration.id);
  const fallback: Target = nextOpen(iterations.slice(index + 1)) ?? "pending";
  const [moves, setMoves] = useState<Record<string, Target>>(() => Object.fromEntries(leftovers.map((f) => [f.id, fallback])));
  const values = [...new Set(Object.values(moves).map(encodeTarget))];
  const same = values.length === 1 ? values[0] : "";
  const options = targets.map((c) => <option key={encodeTarget(c.target)} value={encodeTarget(c.target)}>{columnLabel(c)}</option>);
  const submit = useSubmit();

  return (
    <Modal title={t("iterations.finishDialog.title", { iteration: iterationLabel(iteration) })} size="md" fitViewport onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-3 p-4 text-[12px] text-content/80">
        <p>{t("iterations.finishDialog.summary", { done, left: leftovers.length })}</p>
        {leftovers.length ? (
          <>
            <label className="flex items-center gap-2">
              <span>{t("iterations.finishDialog.moveAll")}</span>
              <select
                value={same}
                onChange={(e) => e.target.value && setMoves(Object.fromEntries(leftovers.map((f) => [f.id, decodeTarget(e.target.value)])))}
                className={`h-8 flex-1 ${field} ${native}`}
              >
                {same ? null : <option value="">{t("iterations.finishDialog.mixed")}</option>}
                {options}
              </select>
            </label>
            <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-content/10">
              {leftovers.map((f) => (
                <li key={f.id} className="flex h-9 items-center gap-2 px-2.5">
                  {f.issue_status ? <StatusIcon status={f.issue_status} /> : <span className="size-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-content/40">{f.issue_ident ?? t("iterations.finishDialog.noIssue")}</span>
                  <select
                    value={encodeTarget(moves[f.id])}
                    onChange={(e) => setMoves({ ...moves, [f.id]: decodeTarget(e.target.value) })}
                    aria-label={t("iterations.moveTo")}
                    className={`h-7 w-36 shrink-0 text-[12px] ${field} ${native}`}
                  >
                    {options}
                  </select>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-content/45">{t("iterations.finishDialog.issuesFollow")}</p>
          </>
        ) : null}
        <p className="text-[11px] text-content/45">{t("iterations.finishDialog.lock")}</p>
        <Footer busy={submit.busy} error={submit.error} onClose={onClose} submitLabel={t("iterations.finishDialog.confirm")} onSubmit={() => void submit.run(() => onFinish(moves))} />
      </div>
    </Modal>
  );
}

/** 手动新建功能：名字 + 放在哪（默认当前筛选不影响，放「待定」）。 */
export function NewFeatureDialog({ iterations, initialTarget, onCreate, onClose }: {
  iterations: Iteration[];
  initialTarget: Target;
  onCreate: (name: string, target: Target) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const [name, setName] = useState("");
  const [target, setTarget] = useState<Target>(initialTarget);
  const input = useRef<HTMLInputElement>(null);
  const submit = useSubmit();
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Modal title={t("iterations.newFeature.title")} size="sm" onClose={onClose}>
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void submit.run(() => onCreate(name.trim(), target));
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>{t("iterations.newFeature.name")}</span>
          <input ref={input} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("iterations.newFeature.placeholder")} className={`h-9 ${field}`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>{t("iterations.newFeature.where")}</span>
          <select value={encodeTarget(target)} onChange={(e) => setTarget(decodeTarget(e.target.value))} className={`h-9 ${field} ${native}`}>
            {moveTargets(iterations).map((c) => <option key={encodeTarget(c.target)} value={encodeTarget(c.target)}>{columnLabel(c)}</option>)}
          </select>
        </label>
        <Footer busy={submit.busy} error={submit.error} onClose={onClose} disabled={!name.trim()} submitLabel={t("iterations.form.create")} />
      </form>
    </Modal>
  );
}
