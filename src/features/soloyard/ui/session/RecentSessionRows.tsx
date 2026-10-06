/**
 * Soloyard：「进行中」面板（上游 LiveAgentsPreview）下面的最近会话。
 * 正在跑 / 等你 / 已完成没看的已经在上面了，这里不重复；悬停出 × 移除。
 */
import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import { projectKey, projectName } from "../../../../shared/lib/paths";
import { ChevronDown, ChevronUp, X } from "../../../../shared/ui/icons";
import { ProjectMascot } from "../../../projects/ui/ProjectMascot";
import {
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupMascot,
} from "../../../workspace/model/tabGroups";
import { removeRecentSession, type RecentSession } from "../../model/recentSessions";

const COLLAPSED = 5;

type Props = {
  recents: RecentSession[];
  /** 已经显示在上面的会话。 */
  liveIds: ReadonlySet<string>;
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupMascots: Record<string, string>;
};

export function RecentSessionRows({ recents, liveIds, activeSessionId, onSelect, ...groups }: Props) {
  const { t } = useTranslation("soloyard");
  const [expanded, setExpanded] = useState(false);
  const rows = recents.filter((item) => !liveIds.has(item.id));
  if (!rows.length) return null;
  const extra = rows.length - COLLAPSED;
  const visible = expanded || extra <= 0 ? rows : rows.slice(0, COLLAPSED);

  return (
    <div className={liveIds.size ? "border-t border-stroke" : ""}>
      <div className="px-3.5 pb-0.5 pt-1.5 text-xs text-content/50">{t("recentSessions.label")}</div>
      <div className={`flex flex-col gap-px px-1 ${extra > 0 ? "" : "pb-1"} ${expanded ? "max-h-[35vh] overflow-y-auto overscroll-none" : ""}`}>
        {visible.map((item) => (
          <RecentRow key={item.id} item={item} selected={item.id === activeSessionId} onSelect={onSelect} {...groups} />
        ))}
      </div>
      {extra > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex w-full items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-content/50 hover:bg-content/8 hover:text-content"
        >
          {expanded ? <ChevronUp className="size-3" strokeWidth={1.75} /> : <ChevronDown className="size-3" strokeWidth={1.75} />}
          {expanded ? t("recentSessions.showLess") : t("recentSessions.more", { count: extra })}
        </button>
      ) : null}
    </div>
  );
}

function RecentRow({
  item,
  selected,
  onSelect,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupMascots,
}: Omit<Props, "recents" | "liveIds" | "activeSessionId"> & { item: RecentSession; selected: boolean }) {
  const { t } = useTranslation("soloyard");
  const seed = projectName(item.cwd);
  const key = projectKey(item.cwd);
  const project = resolveTabGroupLabel(key, groupLabels, seed);
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);

  return (
    <div className={`group relative flex items-center rounded-md ${selected ? "bg-selection" : "hover:bg-content/8"}`}>
      <button
        type="button"
        title={`${item.title}\n${project}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect?.(item.id)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
      >
        <ProjectMascot
          project={seed}
          color={color}
          name={resolveTabGroupMascot(key, groupMascots)}
          className="size-2 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] leading-snug">{item.title}</span>
        <span className="max-w-[40%] shrink-0 truncate text-[11px] text-content/45 group-focus-within:invisible group-hover:invisible">{project}</span>
      </button>
      <button
        type="button"
        aria-label={t("recentSessions.remove")}
        title={t("recentSessions.remove")}
        onClick={() => removeRecentSession(item.id)}
        className="absolute right-1 hidden rounded p-1 text-content/50 hover:bg-content/10 hover:text-content group-focus-within:block group-hover:block"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </div>
  );
}
