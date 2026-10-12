import { RailAction } from "../../../../app/shell/RailAction";
import { useTranslation } from "../../../../i18n";
import { Sparkles } from "../../../../shared/ui/icons";
import { startNewBrainstorm, useIdeaSync } from "../../model/brainstorm";

/**
 * 侧栏收件箱下面的「新想法」：开一个新的头脑风暴（= 一个想法期的项目，文件夹在应用的 workspace/ 下）。
 * 想法本身在项目栏的「头脑风暴」分组里，和别的项目一样点开；这里只负责新建，所以没有选中态。
 * 顺便挂着想法 → 项目栏的同步（标题、分组、归档）。
 */
export function BrainstormRailAction() {
  const { t } = useTranslation("soloyard");
  useIdeaSync();
  return <RailAction label={t("ideas.new")} icon={Sparkles} onClick={() => void startNewBrainstorm()} ariaLabel={t("ideas.new")} />;
}
