import type { BuiltinSkill } from "../../skills/model/skills";
import { t } from "../../../i18n";

export const COMPACT_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "compact",
  invocation: "compact",
  // IndieDesk: getter, so the slash menu reads the current language.
  get description() {
    return t("sessions:commands.compact");
  },
  scope: "builtin",
  source: "monocode",
};

/** Match the standalone composer command without consuming ordinary prompt text. */
export function isCompactCommand(text: string): boolean {
  return /^\s*\/compact\s*$/i.test(text);
}
