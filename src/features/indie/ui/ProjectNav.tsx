import {
  CheckCircle,
  CircleHelp,
  DashboardSquare,
  Eye,
  File,
  ListBullet,
  RefreshCw,
  SlidersHorizontal,
  type IconComponent,
} from "../../../shared/ui/icons";
import { NAV_VIEWS, openProjectView, type ProjectViewId } from "../model/projectViews";

const ICONS: Partial<Record<ProjectViewId, IconComponent>> = {
  overview: DashboardSquare,
  issues: CheckCircle,
  cycles: RefreshCw,
  docs: File,
  decisions: CircleHelp,
  features: ListBullet,
  scope: SlidersHorizontal,
  evidence: Eye,
};

/** 侧栏「Project」分页：竖排的视图列表，点一项在右边开标签。 */
export function ProjectNav({ cwd }: { cwd: string }) {
  if (!cwd || cwd === "~") {
    return <p className="px-3 py-2 text-[12px] text-content/50">No project folder</p>;
  }
  const item = (view: (typeof NAV_VIEWS)[number]) => {
    const Icon = ICONS[view.id]!;
    return (
      <button
        key={view.id}
        type="button"
        onClick={() => openProjectView({ cwd, view: view.id, title: view.label })}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-content/70 hover:bg-content/10 hover:text-content"
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{view.label}</span>
      </button>
    );
  };
  return (
    <nav aria-label="Project" className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2">
      {NAV_VIEWS.filter((view) => view.group === "work").map(item)}
      <div className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-content/40">Planning</div>
      {NAV_VIEWS.filter((view) => view.group === "plan").map(item)}
    </nav>
  );
}
