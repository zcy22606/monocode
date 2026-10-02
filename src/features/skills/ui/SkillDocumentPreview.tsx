import { MarkdownDocumentPreview } from "../../sessions/ui/MarkdownDocumentPreview";
import { useTranslation } from "../../../i18n";

/** Keep the skill's YAML header readable without interpreting it as Markdown. */
export function SkillDocumentPreview({ text }: { text: string }) {
  const { t } = useTranslation("skills");
  return <MarkdownDocumentPreview text={text} metadataLabel={t("preview.metadata")} />;
}
