import { useTranslation } from "../../../../i18n";
import { Sparkles } from "../../../../shared/ui/icons";

/** 侧栏顶部：头脑风暴这个「项目」不显示工作树切换，只显示名字。 */
export function BrainstormSidebarTitle() {
  const { t } = useTranslation("soloyard");
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium leading-tight">
      <Sparkles className="size-3.5 shrink-0 text-content/60" />
      {t("view.brainstorm")}
    </span>
  );
}
