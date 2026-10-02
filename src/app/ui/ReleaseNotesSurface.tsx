import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import {
  releaseNotesMarkdown,
  type ReleaseNotesTabSource,
} from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { useTranslation } from "../../i18n";

export function ReleaseNotesSurface({
  source,
}: {
  source: ReleaseNotesTabSource;
}) {
  const { t } = useTranslation("app");
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const markdown = releaseNotesMarkdown(source);

  return (
    <div
      ref={lockOverscroll}
      className="h-full overflow-y-auto overscroll-none"
    >
      <article
        aria-label={t("releaseNotes.label")}
        className="mx-auto w-full max-w-3xl px-8 py-10"
      >
        {markdown ? (
          <AgentMarkdown text={markdown} streaming={false} />
        ) : (
          <p className="text-[13px] text-content/60">
            {t("releaseNotes.unavailable")}
          </p>
        )}
      </article>
    </div>
  );
}
