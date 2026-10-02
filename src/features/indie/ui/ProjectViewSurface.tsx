import { useTranslation } from "../../../i18n";
import { basename } from "../../../platform/tauri/fs";
import {
  openProjectView,
  viewLabel,
  type ProjectViewId,
  type ProjectViewSource,
} from "../model/projectViews";

/** 占位用的示例条目：只为验证「列表 → 点开详情标签」的交互，接数据时删掉。 */
const SAMPLES = {
  issues: { detail: "issue", name: "sampleIssue", items: [["ISS-1", "A"], ["ISS-2", "B"], ["ISS-3", "C"]] },
  docs: { detail: "doc", name: "sampleDoc", items: [["doc-1", "A"], ["doc-2", "B"]] },
  decisions: { detail: "decision", name: "sampleDecision", items: [["D-1", "A"], ["D-2", "B"]] },
} as const satisfies Partial<Record<ProjectViewId, { detail: ProjectViewId; name: string; items: readonly (readonly [string, string])[] }>>;

const DETAIL_VIEWS: ProjectViewId[] = ["issue", "doc", "decision"];

/** Project 分页打开的标签内容。现在只是占位。 */
export function ProjectViewSurface({ cwd, source, title }: { cwd: string; source: ProjectViewSource; title: string }) {
  const { t } = useTranslation("indie");
  const samples = SAMPLES[source.view as keyof typeof SAMPLES] as (typeof SAMPLES)[keyof typeof SAMPLES] | undefined;
  const isDetail = DETAIL_VIEWS.includes(source.view);
  const heading = isDetail ? title : viewLabel(source.view);
  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 py-8">
        <header className="flex flex-col gap-1">
          <div className="text-[11px] uppercase tracking-wide text-content/40">
            {basename(cwd)} · {isDetail ? viewLabel(source.view) : t("placeholder.project")}
          </div>
          <h1 className="text-[18px] font-medium text-content">{heading}</h1>
        </header>
        {samples ? (
          <ul className="flex flex-col border-t border-stroke">
            {samples.items.map(([id, letter]) => {
              const name = t(`placeholder.${samples.name}`, { letter });
              return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => openProjectView({ cwd, view: samples.detail, itemId: id, title: `${id} ${name}` })}
                  className="flex h-9 w-full items-center gap-3 border-b border-stroke px-1 text-left text-[13px] text-content/80 hover:bg-content/5"
                >
                  <span className="w-14 shrink-0 font-mono text-[12px] text-content/40">{id}</span>
                  <span className="truncate">{name}</span>
                </button>
              </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-[12px] text-content/40">
          {t(samples ? "placeholder.noteSamples" : "placeholder.note")}
        </p>
      </div>
    </div>
  );
}
