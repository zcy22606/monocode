/**
 * 项目设置（概览页右上角）：标题、一句话（和 overview 是同一份）、英文名、issue 前缀、阶段。
 * - 英文名 = 项目文件夹名：只有想法期能改（提升以后文件夹已经建好了）。
 * - issue 前缀：还没有 issue 时能改，有了就锁住（编号会乱）。
 * - 阶段：立项期的小步自动推导不能改；能手动做的只有搁置、放弃（写原因）、上线（建造期）和恢复。
 */
import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import { Modal } from "../../../../shared/ui/Modal";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import type { Issue } from "../../model/issues";
import { entryOf, type Overview, type StageInfo } from "../../model/overview";

const field = "h-8 rounded-md border border-content/10 bg-content/5 px-2.5 text-[13px] text-content outline-none focus:border-content/25 disabled:opacity-60";

export function ProjectSettingsDialog({ project, overview, stage, onClose }: { project: SoloyardProject; overview: Overview; stage: StageInfo; onClose: () => void }) {
  const { t } = useTranslation("soloyard");
  const { data: issues = [] } = useSoloyard<Issue[]>("listIssues", { projectId: project.id, includeSubIssues: true });
  const name = entryOf(overview, "name")!;
  const goal = entryOf(overview, "goal")!;
  const slug = entryOf(overview, "slug")!;
  const [draft, setDraft] = useState({ name: name.body, goal: goal.body, slug: slug.body, key: project.key.startsWith("~") ? "" : project.key });
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const idea = stage.stage === "idea";
  const keyLocked = issues.length > 0;

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = () =>
    run(async () => {
      const updates = [
        ...(draft.name.trim() !== name.body ? [{ key: "name", body: draft.name.trim() }] : []),
        ...(draft.goal !== goal.body ? [{ key: "goal", body: draft.goal }] : []),
        ...(idea && draft.slug !== slug.body ? [{ key: "slug", body: draft.slug.trim() }] : []),
      ];
      if (updates.length) await mutateSoloyard("updateOverview", project.id, updates);
      if (!idea && !keyLocked && draft.key && draft.key !== project.key) await mutateSoloyard("setProjectKey", project.id, draft.key);
      onClose();
    });
  const setStage = (to: "parked" | "killed" | "launched" | "resume") => run(() => mutateSoloyard("setProjectStage", project.id, to, reason.trim() || undefined));

  const row = "grid grid-cols-[96px_1fr] items-center gap-3";
  const label = "text-[12px] text-content/55";
  return (
    <Modal title={t("settings.title")} size="md" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <label className={row}>
          <span className={label}>{t("overview.key.name")}</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} />
        </label>
        <label className={`${row} items-start`}>
          <span className={`${label} pt-1.5`}>{t("overview.key.goal")}</span>
          <textarea value={draft.goal} rows={2} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} className={`${field} h-auto resize-none py-1.5`} />
        </label>
        <label className={row}>
          <span className={label}>{t("overview.key.slug")}</span>
          <span className="flex flex-col gap-1">
            <input value={draft.slug} disabled={!idea} spellCheck={false} onChange={(e) => setDraft({ ...draft, slug: e.target.value.trim() })} className={`${field} font-mono`} />
            {!idea ? <span className="text-[11px] text-content/40">{t("settings.slugLocked")}</span> : null}
          </span>
        </label>
        {!idea ? (
          <label className={row}>
            <span className={label}>{t("settings.key")}</span>
            <span className="flex flex-col gap-1">
              <input value={draft.key} disabled={keyLocked} spellCheck={false} onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase().trim() })} className={`${field} w-28 font-mono`} />
              {keyLocked ? <span className="text-[11px] text-content/40">{t("settings.keyLocked")}</span> : null}
            </span>
          </label>
        ) : null}
        <div className={`${row} items-start border-t border-stroke pt-3`}>
          <span className={`${label} pt-1`}>{t("settings.stage")}</span>
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] text-content">
              {t(`overview.stage.${stage.stage}`)}
              {stage.step ? ` · ${t(`overview.step.${stage.step}`)}` : ""}
              {stage.note?.reason ? <span className="text-content/50"> · {stage.note.reason}</span> : null}
            </span>
            <span className="text-[11px] text-content/40">{t("settings.stageHint")}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("settings.reason")} className={field} />
            <div className="flex flex-wrap gap-1.5">
              {stage.stage === "parked" || stage.stage === "killed" ? (
                <StageButton onClick={() => setStage("resume")}>{t("settings.resume")}</StageButton>
              ) : (
                <>
                  <StageButton onClick={() => setStage("parked")}>{t("overview.stage.parked")}</StageButton>
                  <StageButton disabled={!reason.trim()} onClick={() => setStage("killed")}>{t("settings.kill")}</StageButton>
                  {stage.stage === "building" ? <StageButton onClick={() => setStage("launched")}>{t("settings.launch")}</StageButton> : null}
                </>
              )}
            </div>
          </div>
        </div>
        {error ? <p role="alert" className="text-[12px] text-red-400/90">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-stroke pt-3">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8">{t("iterations.cancel")}</button>
          <button type="button" onClick={() => void save()} className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80">{t("settings.save")}</button>
        </div>
      </div>
    </Modal>
  );
}

function StageButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="rounded-md border border-stroke px-2.5 py-1 text-[12px] text-content/75 hover:bg-content/10 disabled:opacity-40">
      {children}
    </button>
  );
}
