/**
 * 概览页：项目的 overview（产品说明书）+ 阶段 + 下一步。agent 经 MCP 一直在改它，用户也能逐节直接改。
 * 每节显示最后谁、什么时候改的；保存时带读到的版本，期间被别人改过就提示重看，不覆盖。
 */
import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import { AgentMarkdown } from "../../../sessions/ui/AgentMarkdown";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import {
  INIT_STEPS, MAIN_STAGES, SECTION_KEYS, SUGGESTIONS, entryOf, pendingDecisions, runNextStep, runSuggestion,
  type DecisionBrief, type Overview, type OverviewEntry, type StageInfo,
} from "../../model/overview";
import { openProjectView, viewLabel } from "../../model/projectViews";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";

const card = "flex flex-col gap-2 rounded-lg border border-stroke p-4";
const label = "flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-content/40";

export function OverviewView({ project, cwd }: { project: SoloyardProject; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { data: overview, error } = useSoloyard<Overview>("getOverview", project.id);
  const { data: stage } = useSoloyard<StageInfo>("projectStage", project.id);
  const { data: decisions = [] } = useSoloyard<DecisionBrief[]>("listDecisions", project.id);
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState(false);
  if (error) return <p className="p-6 text-[12px] text-red-400">{error}</p>;
  if (!overview || !stage) return null;

  const save = async (entry: OverviewEntry, body: string) => {
    setNotice("");
    try {
      await mutateSoloyard("updateOverview", project.id, [{ key: entry.key, body, expected_version: entry.version }]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const name = entryOf(overview, "name")!;
  const slug = entryOf(overview, "slug")!;
  const pending = pendingDecisions(decisions);

  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        <header className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <InlineField entry={name} onSave={save} placeholder={t("overview.untitled")} className="text-[18px] font-medium text-content" />
            <button type="button" onClick={() => setSettings(true)} className="ml-auto shrink-0 rounded-md px-2 py-1 text-[12px] text-content/50 hover:bg-content/10 hover:text-content">
              {t("settings.title")}
            </button>
          </div>
          <div className="flex items-center gap-2 font-mono text-[12px] text-content/45">
            <InlineField entry={slug} onSave={save} placeholder={t("overview.slugPlaceholder")} className="font-mono" />
            {!project.key.startsWith("~") ? <span>· {project.key}</span> : null}
          </div>
        </header>

        <StageBar stage={stage} />
        {stage.next && stage.next.key !== "building" && stage.next.key !== "idea" ? (
          <div className="flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-content">{t(`overview.next.${stage.next.key}.title`, { count: pending.filter((d) => d.door === "one-way").length })}</div>
              <div className="text-[12px] text-content/55">{t(`overview.next.${stage.next.key}.hint`)}</div>
            </div>
            {stage.next.view || stage.next.prompt ? (
              <button type="button" onClick={() => runNextStep(cwd, stage.next!)} className="shrink-0 rounded-md border border-accent/50 px-2.5 py-1 text-[12px] font-medium text-accent hover:bg-accent/10">
                {t(`overview.next.${stage.next.key}.action`)}
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? <p role="alert" className="text-[12px] text-red-400/90">{notice}</p> : null}

        <SectionCard entry={entryOf(overview, "goal")!} onSave={save} big />
        <div className="grid grid-cols-2 gap-3">
          <div className={card}>
            <div className={label}>
              {t("overview.pending", { count: pending.length })}
              <button type="button" onClick={() => openProjectView({ cwd, view: "decisions", title: viewLabel("decisions") })} className="ml-auto normal-case tracking-normal text-content/50 hover:text-content">
                {t("overview.all")}
              </button>
            </div>
            {pending.length ? (
              <ul className="flex flex-col">
                {pending.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center gap-2 border-t border-stroke py-1.5 text-[12.5px] first:border-t-0">
                    <span className={`shrink-0 rounded px-1.5 text-[10.5px] ${d.door === "one-way" ? "bg-red-400/10 text-red-300" : "bg-content/5 text-content/55"}`}>
                      {t(d.door === "one-way" ? "overview.oneWay" : "overview.twoWay")}
                    </span>
                    <span className="truncate text-content/85">{d.code} {d.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-content/40">{t("overview.noPending")}</p>
            )}
          </div>
          <SectionCard entry={entryOf(overview, "stoploss")!} onSave={save} />
        </div>

        {SECTION_KEYS.map((key) => <SectionCard key={key} entry={entryOf(overview, key)!} onSave={save} />)}

        <div className={card}>
          <div className={label}>{t("overview.suggestTitle")}</div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((key) => (
              <button key={key} type="button" title={t(`overview.suggest.${key}.hint`)} onClick={() => runSuggestion(cwd, key)} className="rounded-md border border-stroke px-2.5 py-1 text-[12px] text-content/70 hover:bg-content/10 hover:text-content">
                {t(`overview.suggest.${key}.label`)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-content/35">{t("overview.snapshotNote")}</p>
      </div>
      {settings ? <ProjectSettingsDialog project={project} overview={overview} stage={stage} onClose={() => setSettings(false)} /> : null}
    </div>
  );
}

/** 阶段进度条：想法 → 立项 → 建造 → 上线；立项期下面列小步。搁置 / 放弃单独显示原因。 */
function StageBar({ stage }: { stage: StageInfo }) {
  const { t } = useTranslation("soloyard");
  if (stage.stage === "parked" || stage.stage === "killed") {
    return (
      <div className="rounded-lg border border-stroke bg-content/5 px-3 py-2 text-[12px] text-content/70">
        {t(`overview.stage.${stage.stage}`)}
        {stage.note?.reason ? <span className="text-content/50"> · {stage.note.reason}</span> : null}
      </div>
    );
  }
  const at = MAIN_STAGES.indexOf(stage.stage);
  const stepAt = stage.step ? INIT_STEPS.indexOf(stage.step) : -1;
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex">
        {MAIN_STAGES.map((s, i) => (
          <li key={s} className="relative flex flex-1 flex-col items-center gap-1 pt-1 text-[11.5px]">
            <span className="absolute left-0 right-0 top-[9px] h-px bg-stroke" />
            <span className={`relative size-2.5 rounded-full border ${i < at ? "border-accent bg-accent" : i === at ? "border-amber-400 bg-amber-400" : "border-stroke bg-background-base"}`} />
            <span className={i === at ? "font-medium text-content" : i < at ? "text-content/55" : "text-content/35"}>{t(`overview.stage.${s}`)}</span>
          </li>
        ))}
      </ol>
      {stage.stage === "initiating" ? (
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          {INIT_STEPS.map((s, i) => (
            <span key={s} className={`rounded-full border px-2 ${i < stepAt ? "border-stroke text-content/40 line-through" : i === stepAt ? "border-amber-400/40 text-amber-300" : "border-stroke text-content/35"}`}>
              {t(`overview.step.${s}`)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WhoWhen({ entry }: { entry: OverviewEntry }) {
  const { t, i18n } = useTranslation("soloyard");
  if (!entry.updated_by || !entry.updated_at) return null;
  const who = entry.updated_by === "user" ? t("detail.you") : entry.updated_by.replace(/^agent:/, "");
  const when = new Date(entry.updated_at).toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return <span className={`normal-case tracking-normal ${entry.updated_by === "user" ? "text-emerald-300/70" : "text-content/35"}`}>{who} · {when}</span>;
}

/** 一节：标题 + 谁改的 + 正文（markdown）；点「编辑」换成文本框，失焦保存。 */
function SectionCard({ entry, onSave, big }: { entry: OverviewEntry; onSave: (e: OverviewEntry, body: string) => void; big?: boolean }) {
  const { t } = useTranslation("soloyard");
  const [editing, setEditing] = useState(false);
  return (
    <section className={card}>
      <div className={label}>
        {t(`overview.key.${entry.key}`)}
        <span className="ml-auto flex items-center gap-2">
          <WhoWhen entry={entry} />
          {!editing ? (
            <button type="button" onClick={() => setEditing(true)} className="normal-case tracking-normal text-content/45 hover:text-content">
              {t("detail.edit")}
            </button>
          ) : null}
        </span>
      </div>
      {editing ? (
        <textarea
          autoFocus
          defaultValue={entry.body}
          rows={Math.max(big ? 2 : 4, entry.body.split("\n").length + 1)}
          onBlur={(e) => {
            setEditing(false);
            if (e.target.value !== entry.body) onSave(entry, e.target.value);
          }}
          placeholder={t("detail.markdownHint")}
          className="w-full resize-y rounded-md border border-stroke bg-content/5 p-3 font-mono text-[12px] leading-relaxed text-content outline-none"
        />
      ) : entry.body.trim() ? (
        big ? <p className="text-[15px] font-medium leading-relaxed text-content">{entry.body}</p> : <AgentMarkdown text={entry.body} streaming={false} />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-left text-[12px] italic text-content/35 hover:text-content/60">
          {t("overview.empty")}
        </button>
      )}
    </section>
  );
}

/** 单行字段（标题、英文名）：点了直接改，回车或失焦保存，Esc 放弃。 */
function InlineField({ entry, onSave, className, placeholder }: { entry: OverviewEntry; onSave: (e: OverviewEntry, body: string) => void; className?: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={`w-fit rounded px-0.5 text-left hover:bg-content/5 ${className ?? ""} ${entry.body ? "" : "text-content/30"}`}>
        {entry.body || placeholder}
      </button>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={entry.body}
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={(e) => {
        setEditing(false);
        const value = e.target.value.trim();
        if (value && value !== entry.body) onSave(entry, value);
      }}
      className={`rounded border border-stroke bg-content/5 px-1 outline-none ${className ?? ""}`}
    />
  );
}

