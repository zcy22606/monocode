/**
 * Soloyard：顶栏（SOL-66）。标签区收起后的「当前标题 ▾ N」，和右边的「收起 / 展开标签 + 项目面板开关」。
 * 上游 TitleBar 只挂这两个组件。
 */
import { useState } from "react";
import type { Tab } from "../../../app/shell/TitleBar";
import { useTranslation } from "../../../i18n";
import { CheckCircle, ChevronDown, ChevronLeft, ChevronRight, PanelRightToggle, Terminal, X } from "../../../shared/ui/icons";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import { Popover } from "../../../shared/ui/Popover";
import { panelShownFor, toggleProjectPanel, useProjectPanel } from "../model/projectPanel";
import { toggleTitleTabsCollapsed, useTitleTabsCollapsed } from "../model/titleTabs";

/** 收起的标签区：只显示当前标签的标题，点开列出本项目的标签，可切换、关闭。 */
export function CollapsedTitleTabs({
  tabs,
  activeId,
  headline,
  closable,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  activeId: string;
  headline: (tab: Tab) => string;
  closable: (tab: Tab) => boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useTranslation("soloyard");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = tabs.find((tab) => tab.id === activeId);
  return (
    <div className="flex h-full min-w-0 flex-1 items-center pl-1.5">
      <button
        type="button"
        data-tauri-drag-region="false"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-content hover:bg-content/10"
      >
        {active ? <TabIcon tab={active} /> : null}
        <span className="min-w-0 truncate font-medium">{active ? headline(active) : ""}</span>
        <ChevronDown className="size-3 shrink-0 text-content/50" strokeWidth={2} />
        {tabs.length > 1 ? <span className="shrink-0 text-[11px] text-content/45">{tabs.length}</span> : null}
      </button>
      {anchor ? (
        <Popover anchor={anchor} side="bottom" align="start" width={340} onDismiss={() => setAnchor(null)} role="menu" aria-label={t("titleTabs.list", { count: tabs.length })}>
          <ul className="flex max-h-[60vh] flex-col overflow-y-auto p-1">
            {tabs.map((tab) => (
              <li key={tab.id} className={`group flex h-8 items-center rounded-md ${tab.id === activeId ? "bg-selection" : "hover:bg-content/10"}`}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAnchor(null);
                    onSelect(tab.id);
                  }}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[13px] text-content"
                >
                  <TabIcon tab={tab} />
                  <span className="truncate">{headline(tab)}</span>
                </button>
                {closable(tab) ? (
                  <button
                    type="button"
                    aria-label={t("titleTabs.close", { name: headline(tab) })}
                    title={t("titleTabs.close", { name: headline(tab) })}
                    onClick={() => onClose(tab.id)}
                    className="mr-1 grid size-6 shrink-0 place-items-center rounded text-content/40 opacity-0 hover:bg-content/10 hover:text-content group-hover:opacity-100"
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </div>
  );
}

/** 标签前的图标，照上游标签条（TitleBar 的 TabHarnesses）：会话是 CLI 图标，跑着转圈、跑完没看打勾；文件按类型；终端。 */
function TabIcon({ tab }: { tab: Tab }) {
  const harness = tab.harnesses[0];
  if (harness) {
    if (tab.busyHarnesses.length > 0)
      return <TerminalSpinner className="inline-block w-3.5 shrink-0 select-none text-center text-[11px] leading-none text-accent" />;
    if ((tab.doneHarnesses?.length ?? 0) > 0) return <CheckCircle className="size-3.5 shrink-0 text-teal-400" strokeWidth={2} />;
    return <HarnessIcon harness={harness} className="size-3.5 shrink-0" />;
  }
  if (tab.terminal || !tab.files[0]) return <Terminal className="size-3.5 shrink-0 text-content/60" strokeWidth={1.75} />;
  return <FileTypeIcon name={tab.files[0]} isDir={false} size={14} />;
}

/** 顶栏右边：收起 / 展开标签，项目面板开关（没有项目时不显示；头脑风暴里也有，面板是侧栏选中的项目）。 */
export function TitleBarTools({ cwd, project }: { cwd: string; project: boolean }) {
  const { t } = useTranslation("soloyard");
  const collapsed = useTitleTabsCollapsed();
  const open = panelShownFor(useProjectPanel(), cwd);
  const Toggle = collapsed ? ChevronRight : ChevronLeft;
  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-2" data-tauri-drag-region="false">
      <button
        type="button"
        aria-label={t(collapsed ? "titleTabs.expand" : "titleTabs.collapse")}
        title={t(collapsed ? "titleTabs.expand" : "titleTabs.collapse")}
        onClick={toggleTitleTabsCollapsed}
        className="grid size-6.5 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
      >
        <Toggle className="size-3.5" strokeWidth={1.75} />
      </button>
      {project ? (
        <button
          type="button"
          aria-label={t("panel.label")}
          aria-pressed={open}
          title={t("panel.label")}
          onClick={() => toggleProjectPanel(cwd)}
          className={`ml-1 grid size-6.5 place-items-center rounded-md ${
            open ? "bg-selection text-content" : "text-content/55 hover:bg-content/10 hover:text-content"
          }`}
        >
          <PanelRightToggle className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
