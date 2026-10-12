import { RailAction } from "../../../../app/shell/RailAction";
import { useTranslation } from "../../../../i18n";
import { Sparkles } from "../../../../shared/ui/icons";
import { openBrainstorm, useBrainstormTitleSync } from "../../model/brainstorm";
import { useBrainstormActive } from "../../model/projectViews";

/** 侧栏收件箱下面的「头脑风暴」：和点项目一样，回到最近的头脑风暴会话（没有才新开）；在头脑风暴会话里时高亮，侧栏换成头脑风暴列表。 */
export function BrainstormRailAction() {
  const { t } = useTranslation("soloyard");
  const active = useBrainstormActive();
  useBrainstormTitleSync();
  return <RailAction label={t("view.brainstorm")} icon={Sparkles} onClick={() => void openBrainstorm()} active={active} ariaLabel={t("view.brainstorm")} />;
}
