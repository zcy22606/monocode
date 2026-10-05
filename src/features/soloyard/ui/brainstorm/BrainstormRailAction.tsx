import { RailAction } from "../../../../app/shell/RailAction";
import { useTranslation } from "../../../../i18n";
import { Sparkles } from "../../../../shared/ui/icons";
import { startNewBrainstorm } from "../../model/brainstorm";
import { useBrainstormActive } from "../../model/projectViews";

/** 侧栏收件箱下面的「头脑风暴」：直接开一个新的头脑风暴会话；在头脑风暴会话里时高亮，侧栏换成头脑风暴列表。 */
export function BrainstormRailAction() {
  const { t } = useTranslation("soloyard");
  const active = useBrainstormActive();
  return <RailAction label={t("view.brainstorm")} icon={Sparkles} onClick={() => void startNewBrainstorm()} active={active} ariaLabel={t("view.brainstorm")} />;
}
