import { useTranslation } from "../../../i18n";
import { NAV_VIEWS, openProjectView, useActiveProjectNav, viewLabel } from "../model/projectViews";
import { PROJECT_VIEW_ICONS } from "./ProjectViewIcon";

/** 侧栏「Project」分页：竖排的视图列表，点一项在右边开标签。 */
export function ProjectNav({ cwd }: { cwd: string }) {
  const { t } = useTranslation("soloyard");
  const activeNav = useActiveProjectNav(cwd);
  if (!cwd || cwd === "~") {
    return <p className="px-3 py-2 text-[12px] text-content/50">{t("nav.noFolder")}</p>;
  }
  const item = (view: (typeof NAV_VIEWS)[number]) => {
    const Icon = PROJECT_VIEW_ICONS[view.id];
    const label = viewLabel(view.id);
    return (
      <button
        key={view.id}
        type="button"
        aria-current={activeNav === view.id ? "page" : undefined}
        onClick={() => openProjectView({ cwd, view: view.id, title: label })}
        className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${activeNav === view.id ? "bg-selection text-content" : "text-content/70 hover:bg-content/10 hover:text-content"}`}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    );
  };
  return (
    <nav aria-label={t("nav.label")} className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2">
      {NAV_VIEWS.filter((view) => view.group === "work").map(item)}
      <div className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-content/40">{t("nav.planning")}</div>
      {NAV_VIEWS.filter((view) => view.group === "plan").map(item)}
    </nav>
  );
}
