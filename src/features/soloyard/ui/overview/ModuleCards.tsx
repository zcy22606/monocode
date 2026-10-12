/**
 * 项目主页顶部的模块卡片：每张既显示这个模块的现状，又是进去的入口（点了压进面板的导航栈，面包屑能回主页）。
 * 当前迭代、Issues、决策、文档、证据、仓库，顺序和面包屑下拉一样（PANEL_MODULES）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "../../../../i18n";
import { useSoloyard, type SoloyardProject } from "../../data/api";
import type { Decision, Evidence } from "../../model/decisions";
import { scanDocs } from "../../model/docs";
import type { Issue } from "../../model/issues";
import type { IterationPlan } from "../../model/iterations";
import { issueCounts, iterationSummary, pendingDecisions } from "../../model/overview";
import { openProjectView, viewLabel, type ProjectViewId } from "../../model/projectViews";
import { useProjectRepos } from "../../model/repos";
import { ProjectViewIcon } from "../ProjectViewIcon";

export function ModuleCards({ project, cwd }: { project: SoloyardProject; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { data: plan } = useSoloyard<IterationPlan>("iterationPlan", project.id);
  const { data: issues } = useSoloyard<Issue[]>("listIssues", { projectId: project.id });
  const { data: decisions = [] } = useSoloyard<Decision[]>("listDecisions", project.id);
  const { data: evidence = [] } = useSoloyard<Evidence[]>("listEvidence", project.id);
  const repos = useProjectRepos(cwd)?.repos ?? [];
  const [docs, setDocs] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void scanDocs(cwd).then((list) => alive && setDocs(list?.filter((d) => d.rel.toLowerCase() !== "overview.md").length ?? 0), () => undefined);
    return () => {
      alive = false;
    };
  }, [cwd]);

  const iteration = iterationSummary(plan);
  const counts = issueCounts(issues);
  const pending = pendingDecisions(decisions);
  const oneWay = pending.filter((d) => d.door === "one-way").length;
  const open = (view: ProjectViewId) => openProjectView({ cwd, view, title: viewLabel(view) });

  return (
    <div className="grid grid-cols-2 gap-2">
      <Card view="cycles" onOpen={open}>
        {iteration ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
              <span className="shrink-0 rounded bg-content/10 px-1 font-mono text-[11px] text-content">{iteration.tag}</span>
              <span className="truncate text-content/85">{iteration.name || t(iteration.active ? "modules.active" : "modules.planned")}</span>
            </span>
            {iteration.total ? (
              <>
                <div className="h-1 overflow-hidden rounded bg-content/10">
                  <div className="h-full bg-accent" style={{ width: `${(iteration.done / iteration.total) * 100}%` }} />
                </div>
                <span className="text-[11px] text-content/45">{t("modules.progress", { done: iteration.done, total: iteration.total })}</span>
              </>
            ) : (
              <span className="text-[11px] text-content/45">{t(iteration.active ? "modules.noIssues" : "modules.notStarted")}</span>
            )}
          </>
        ) : (
          <Muted>{t("modules.noIteration")}</Muted>
        )}
      </Card>
      <Card view="issues" onOpen={open}>
        <span className="flex flex-wrap gap-x-2 text-[12.5px] text-content/85">
          <span>{t("modules.todo", { count: counts.todo })}</span>
          <span>{t("modules.inProgress", { count: counts.inProgress })}</span>
          <span className={counts.inReview ? "text-sky-300" : ""}>{t("modules.inReview", { count: counts.inReview })}</span>
        </span>
      </Card>
      <Card view="decisions" onOpen={open} alert={oneWay > 0}>
        {pending.length ? (
          <span className="text-[12.5px] text-content/85">
            {t("modules.pending", { count: pending.length })}
            {oneWay ? <span className="text-red-300"> · {t("modules.oneWay", { count: oneWay })}</span> : null}
          </span>
        ) : (
          <Muted>{decisions.length ? t("modules.allDecided", { count: decisions.length }) : t("modules.noDecisions")}</Muted>
        )}
      </Card>
      <Card view="docs" onOpen={open}>
        <Muted>{docs === null ? "…" : t("modules.docs", { count: docs })}</Muted>
      </Card>
      <Card view="evidence" onOpen={open}>
        <Muted>{t("modules.evidence", { count: evidence.length })}</Muted>
      </Card>
      <Card view="repos" onOpen={open}>
        <Muted>{repos.length ? t("modules.repos", { count: repos.length }) : t("modules.singleRepo")}</Muted>
      </Card>
    </div>
  );
}

function Card({ view, onOpen, alert, children }: { view: ProjectViewId; onOpen: (view: ProjectViewId) => void; alert?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(view)}
      className={`flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left hover:bg-content/5 ${alert ? "border-amber-400/40" : "border-stroke"}`}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-content/45">
        <ProjectViewIcon view={view} className="size-3.5 shrink-0" />
        {viewLabel(view)}
      </span>
      {children}
    </button>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-[12.5px] text-content/55">{children}</span>;
