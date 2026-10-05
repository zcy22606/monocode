import {
  CheckCircle,
  CircleHelp,
  DashboardSquare,
  Eye,
  File,
  FolderTree,
  ListBullet,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Sparkles,
  type IconComponent,
} from "../../../shared/ui/icons";
import type { ProjectViewId } from "../model/projectViews";

/** Project 视图的图标：侧栏列表、顶部标签、分屏标签共用。详情类标签用所属列表的图标。 */
export const PROJECT_VIEW_ICONS: Record<ProjectViewId, IconComponent> = {
  overview: DashboardSquare,
  issues: CheckCircle,
  issue: CheckCircle,
  cycles: RefreshCw,
  docs: File,
  doc: File,
  decisions: CircleHelp,
  decision: CircleHelp,
  features: ListBullet,
  scope: SlidersHorizontal,
  evidence: Eye,
  service: Server,
  brainstorm: Sparkles,
  repos: FolderTree,
};

export function ProjectViewIcon({ view, className = "size-3.5 shrink-0" }: { view: ProjectViewId; className?: string }) {
  const Icon = PROJECT_VIEW_ICONS[view];
  return <Icon className={className} />;
}
