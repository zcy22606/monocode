import { useTranslation } from "../../../i18n";
import { basename } from "../../../platform/tauri/fs";
import { useProjectForPath } from "../data/api";
import { viewLabel, type ProjectViewId, type ProjectViewSource } from "../model/projectViews";
import { IssueDetail } from "./issues/IssueDetail";
import { IssuesView } from "./issues/IssuesView";
import { IterationsView } from "./iterations/IterationsView";
import { ReposView } from "./repos/ReposView";
import { OverviewView } from "./overview/OverviewView";
import { DecisionsView, EvidenceView } from "./decisions/DecisionsView";
import { DocsView } from "./docs/DocsView";
import { DocDetail } from "./docs/DocDetail";
import { ServiceLog } from "../services/ServiceLog";
import { startNewBrainstorm } from "../model/brainstorm";

const DETAIL_VIEWS: ProjectViewId[] = ["issue", "decision"];

/** Project 分页打开的标签内容：已经做好的视图走真实数据，其余还是占位。 */
export function ProjectViewSurface({ cwd, source, title }: { cwd: string; source: ProjectViewSource; title: string }) {
  if (source.view === "service") return <ServiceLog cwd={cwd} itemId={source.itemId ?? ""} />;
  if (source.view === "brainstorm") return <BrainstormMoved />;
  // 文档以项目根目录 docs/ 里的文件为准，直接读文件，不经数据库
  if (source.view === "docs") return <DocsView cwd={cwd} />;
  if (source.view === "doc") return <DocDetail cwd={cwd} rel={source.itemId ?? ""} />;
  return <ProjectDataView cwd={cwd} source={source} title={title} />;
}

function ProjectDataView({ cwd, source, title }: { cwd: string; source: ProjectViewSource; title: string }) {
  const { data: project, error } = useProjectForPath(cwd);
  // 迭代 = 功能全景 + 减法 + 迭代；旧的 features / scope 标签也落到这里
  const iterations = source.view === "cycles" || source.view === "features" || source.view === "scope";
  const facts = source.view === "overview" || source.view === "decisions" || source.view === "decision" || source.view === "evidence";
  if (source.view === "issues" || source.view === "issue" || source.view === "repos" || facts || iterations) {
    if (error) return <p className="p-6 text-[12px] text-red-400">{error}</p>;
    if (!project) return null;
    if (source.view === "overview") return <OverviewView project={project} cwd={cwd} />;
    if (source.view === "decisions" || source.view === "decision") return <DecisionsView project={project} cwd={cwd} focus={source.itemId} />;
    if (source.view === "evidence") return <EvidenceView project={project} />;
    if (iterations) return <IterationsView project={project} cwd={cwd} />;
    if (source.view === "repos") return <ReposView project={project} cwd={cwd} />;
    return source.view === "issues" ? <IssuesView project={project} cwd={cwd} /> : <IssueDetail issueId={Number(source.itemId)} cwd={cwd} />;
  }
  return <Placeholder cwd={cwd} source={source} title={title} />;
}

/** 还没做的视图：只显示标题和一句说明（项目视图都接上真实数据后，只有未知的旧标签会落到这里）。 */
function Placeholder({ cwd, source, title }: { cwd: string; source: ProjectViewSource; title: string }) {
  const { t } = useTranslation("soloyard");
  const isDetail = DETAIL_VIEWS.includes(source.view);
  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 py-8">
        <header className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-wide text-content/40">
            {basename(cwd)} · {isDetail ? viewLabel(source.view) : t("placeholder.project")}
          </div>
          <h1 className="text-[18px] font-medium text-content">{isDetail ? title : viewLabel(source.view)}</h1>
        </header>
        <p className="text-[12px] text-content/40">{t("placeholder.note")}</p>
      </div>
    </div>
  );
}

/** 早期原型留下的「头脑风暴」标签：头脑风暴已经改成左侧入口 + 侧栏列表。 */
function BrainstormMoved() {
  const { t } = useTranslation("soloyard");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-sm text-[12px] leading-relaxed text-content/55">{t("brainstorm.moved")}</p>
      <button type="button" onClick={() => void startNewBrainstorm()} className="rounded-md bg-content/10 px-3 py-1.5 text-[12px] text-content hover:bg-content/15">
        {t("brainstorm.start")}
      </button>
    </div>
  );
}
