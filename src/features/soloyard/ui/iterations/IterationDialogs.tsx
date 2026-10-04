/**
 * 迭代的新建 / 编辑弹窗和删除弹窗。
 * 版本号必填且不能重复（预填下一个小版本，可一键换成下一个大版本）；名称、目标、目标日期都可选。
 * 删除时必须给里面的功能选一个去处，功能和已建的 issue 都不会丢。
 * 开始迭代：逐个勾选要建 issue 的功能；完成迭代：没做完的功能逐个选去处（默认下一个版本）。
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { StatusIcon } from "../issues/IssueIcons";
import type { IssueStatus } from "../../model/issues";
import type { MockFeature } from "../../mock/iterationsMock";
import { useTranslation } from "../../../../i18n";
import { Modal } from "../../../../shared/ui/Modal";
import type { MockIteration } from "../../mock/iterationsMock";
import { suggestVersions, versionTaken, type IterationInput } from "../../mock/iterationsStore";

const field = "rounded-md border border-content/10 bg-content/5 px-2.5 text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25";
const labelText = "text-[12px] font-medium text-content/70";
const optional = "ml-1 font-normal text-content/35";
/** 原生日期 / 下拉控件跟随应用主题（应用默认深色，浅色时根节点有 theme-light）。 */
const native = "[color-scheme:dark] [.theme-light_&]:[color-scheme:light]";
const cancelButton = "rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content";

const iterationLabel = (it: MockIteration, untitled: string) => [it.version, it.name].filter(Boolean).join(" · ") || untitled;
/** 功能能挪去的地方：除了自己和已完成（锁定）的迭代。 */
const moveTargets = (iterations: MockIteration[], exceptId: string) => iterations.filter((i) => i.id !== exceptId && i.status !== "done");
/** 从 from 开始第一个没完成的版本。 */
const nextOpen = (releases: MockIteration[], from: number) => releases.slice(from).find((i) => i.status !== "done")?.id;
const primaryButton = "rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40";

/** editing 为空 = 新建（多一个「位置」）；否则编辑这个迭代。 */
export function IterationFormDialog({
  iterations,
  editing,
  onSubmit,
  onClose,
}: {
  iterations: MockIteration[];
  editing?: MockIteration;
  onSubmit: (input: IterationInput, beforeId: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const suggested = suggestVersions(iterations);
  const [version, setVersion] = useState(editing?.version ?? suggested.minor);
  const [name, setName] = useState(editing?.name ?? "");
  const [goal, setGoal] = useState(editing?.goal ?? "");
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? "");
  const [beforeId, setBeforeId] = useState("");
  const versionInput = useRef<HTMLInputElement>(null);
  const releases = iterations.filter((i) => i.kind === "release");

  useEffect(() => {
    const frame = requestAnimationFrame(() => versionInput.current?.select());
    return () => cancelAnimationFrame(frame);
  }, []);

  const trimmed = version.trim();
  const error = !trimmed ? t("iterations.form.versionRequired") : versionTaken(iterations, trimmed, editing?.id) ? t("iterations.form.versionTaken", { version: trimmed }) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (error) return versionInput.current?.focus();
    onSubmit({ version: trimmed, name: name.trim(), goal: goal.trim(), targetDate: targetDate || undefined }, beforeId || null);
  };

  return (
    <Modal title={editing ? t("iterations.form.editTitle") : t("iterations.form.newTitle")} size="sm" onClose={onClose}>
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>{t("iterations.form.version")}</span>
          <input
            ref={versionInput}
            value={version}
            maxLength={24}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
            onChange={(e) => setVersion(e.target.value)}
            className={`h-9 font-mono ${field} ${error ? "border-red-400/50" : ""}`}
          />
          <span className="flex items-center gap-1.5 text-[11px] text-content/45">
            {editing ? null : (
              <>
                {t("iterations.form.suggest")}
                {[suggested.minor, suggested.major].map((v) => (
                  <button key={v} type="button" onClick={() => setVersion(v)} className={`rounded px-1.5 font-mono ${trimmed === v ? "bg-selection text-content" : "bg-content/5 hover:bg-content/10 hover:text-content"}`}>
                    {v}
                  </button>
                ))}
              </>
            )}
            {error ? <span role="alert" className="ml-auto text-red-400/90">{error}</span> : null}
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
          {editing || !releases.length ? null : (
            <label className="flex flex-1 flex-col gap-1.5">
              <span className={labelText}>{t("iterations.form.position")}</span>
              <select value={beforeId} onChange={(e) => setBeforeId(e.target.value)} className={`h-9 ${field} ${native}`}>
                <option value="">{t("iterations.form.positionLast")}</option>
                {releases.map((it) => (
                  <option key={it.id} value={it.id}>{t("iterations.form.positionBefore", { iteration: iterationLabel(it, t("iterations.untitled")) })}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelButton}>{t("iterations.cancel")}</button>
          <button type="submit" disabled={!!error} className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40">
            {editing ? t("iterations.form.save") : t("iterations.form.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 删除迭代：有功能时必须选去处（默认挪到后一个版本，没有就前一个，再没有就「待定」）。已完成的迭代锁定，不能当去处。 */
export function DeleteIterationDialog({
  iteration,
  iterations,
  featureCount,
  issueCount,
  onDelete,
  onClose,
}: {
  iteration: MockIteration;
  iterations: MockIteration[];
  featureCount: number;
  issueCount: number;
  onDelete: (moveTo: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const releases = iterations.filter((i) => i.kind === "release");
  const index = releases.findIndex((i) => i.id === iteration.id);
  const targets = moveTargets(iterations, iteration.id);
  const [moveTo, setMoveTo] = useState(nextOpen(releases, index + 1) ?? nextOpen(releases.slice(0, index).reverse(), 0) ?? "pending");
  const label = iterationLabel(iteration, t("iterations.untitled"));

  return (
    <Modal title={t("iterations.remove.title", { iteration: label })} size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4 p-4 text-[12px] text-content/80">
        {iteration.status !== "planned" ? (
          <p className="rounded-md bg-amber-400/10 px-2.5 py-2 text-amber-300">{t(iteration.status === "active" ? "iterations.remove.active" : "iterations.remove.done")}</p>
        ) : null}
        {featureCount ? (
          <label className="flex flex-col gap-1.5">
            <span>{t("iterations.remove.moveFeatures", { count: featureCount })}</span>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`h-9 ${field} ${native}`}>
              {targets.map((it) => <option key={it.id} value={it.id}>{iterationLabel(it, t("iterations.untitled"))}</option>)}
            </select>
            {issueCount ? <span className="text-[11px] text-content/45">{t("iterations.remove.issuesFollow", { count: issueCount })}</span> : null}
          </label>
        ) : (
          <p>{t("iterations.remove.empty")}</p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelButton}>{t("iterations.cancel")}</button>
          <button type="button" onClick={() => onDelete(moveTo)} className="rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-400 hover:bg-red-500/30">
            {t("iterations.remove.confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

type FeatureIssue = { ident: string; status: IssueStatus } | undefined;

/** 开始迭代：默认给所有还没 issue 的功能建 issue，可以逐个取消；已有 issue 的不重复建。 */
export function StartIterationDialog({
  iteration,
  features,
  issueOf,
  activeOther,
  onStart,
  onClose,
}: {
  iteration: MockIteration;
  features: MockFeature[];
  issueOf: (code: string) => FeatureIssue;
  /** 另一个进行中的迭代（只提醒，不拦）。 */
  activeOther?: MockIteration;
  onStart: (codes: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const fresh = features.filter((f) => !issueOf(f.code));
  const [picked, setPicked] = useState(() => new Set(fresh.map((f) => f.code)));
  const toggle = (code: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; });
  const all = picked.size === fresh.length;
  const label = iterationLabel(iteration, t("iterations.untitled"));

  return (
    <Modal title={t("iterations.startDialog.title", { iteration: label })} size="md" fitViewport onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-3 p-4 text-[12px] text-content/80">
        {activeOther ? (
          <p className="rounded-md bg-amber-400/10 px-2.5 py-2 text-amber-300">{t("iterations.startDialog.activeOther", { iteration: iterationLabel(activeOther, t("iterations.untitled")) })}</p>
        ) : null}
        {fresh.length ? (
          <>
            <div className="flex items-center gap-2">
              <span>{t("iterations.startDialog.pick", { count: fresh.length })}</span>
              <button type="button" onClick={() => setPicked(new Set(all ? [] : fresh.map((f) => f.code)))} className="ml-auto rounded px-1.5 py-0.5 text-content/60 hover:bg-content/10 hover:text-content">
                {all ? t("iterations.startDialog.none") : t("iterations.startDialog.all")}
              </button>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-content/10">
              {fresh.map((f) => (
                <li key={f.code}>
                  <label className="flex h-8 items-center gap-2 px-2.5 hover:bg-content/5">
                    <input type="checkbox" checked={picked.has(f.code)} onChange={() => toggle(f.code)} className="accent-accent" />
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
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelButton}>{t("iterations.cancel")}</button>
          <button type="button" onClick={() => onStart([...picked])} className={primaryButton}>
            {picked.size ? t("iterations.startDialog.confirm", { count: picked.size }) : t("iterations.start")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 完成迭代：列出没做完的功能，默认挪到下一个没完成的版本（没有就「待定」），可以统一改也可以逐个改。 */
export function FinishIterationDialog({
  iteration,
  iterations,
  done,
  leftovers,
  issueOf,
  onFinish,
  onClose,
}: {
  iteration: MockIteration;
  iterations: MockIteration[];
  done: number;
  leftovers: MockFeature[];
  issueOf: (code: string) => FeatureIssue;
  onFinish: (moves: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("soloyard");
  const releases = iterations.filter((i) => i.kind === "release");
  const targets = moveTargets(iterations, iteration.id);
  const fallback = nextOpen(releases, releases.findIndex((i) => i.id === iteration.id) + 1) ?? "pending";
  const [moves, setMoves] = useState<Record<string, string>>(() => Object.fromEntries(leftovers.map((f) => [f.code, fallback])));
  const same = new Set(Object.values(moves)).size === 1 ? Object.values(moves)[0] : "";
  const label = iterationLabel(iteration, t("iterations.untitled"));
  const options = targets.map((it) => <option key={it.id} value={it.id}>{iterationLabel(it, t("iterations.untitled"))}</option>);

  return (
    <Modal title={t("iterations.finishDialog.title", { iteration: label })} size="md" fitViewport onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-3 p-4 text-[12px] text-content/80">
        <p>{t("iterations.finishDialog.summary", { done, left: leftovers.length })}</p>
        {leftovers.length ? (
          <>
            <label className="flex items-center gap-2">
              <span>{t("iterations.finishDialog.moveAll")}</span>
              <select
                value={same}
                onChange={(e) => e.target.value && setMoves(Object.fromEntries(leftovers.map((f) => [f.code, e.target.value])))}
                className={`h-8 flex-1 ${field} ${native}`}
              >
                {same ? null : <option value="">{t("iterations.finishDialog.mixed")}</option>}
                {options}
              </select>
            </label>
            <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-content/10">
              {leftovers.map((f) => {
                const issue = issueOf(f.code);
                return (
                  <li key={f.code} className="flex h-9 items-center gap-2 px-2.5">
                    {issue ? <StatusIcon status={issue.status} /> : <span className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-content/40">{issue?.ident ?? t("iterations.finishDialog.noIssue")}</span>
                    <select value={moves[f.code]} onChange={(e) => setMoves({ ...moves, [f.code]: e.target.value })} aria-label={t("iterations.moveTo")} className={`h-7 w-36 shrink-0 text-[12px] ${field} ${native}`}>
                      {options}
                    </select>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-content/45">{t("iterations.finishDialog.issuesFollow")}</p>
          </>
        ) : null}
        <p className="text-[11px] text-content/45">{t("iterations.finishDialog.lock")}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelButton}>{t("iterations.cancel")}</button>
          <button type="button" onClick={() => onFinish(moves)} className={primaryButton}>{t("iterations.finishDialog.confirm")}</button>
        </div>
      </div>
    </Modal>
  );
}
