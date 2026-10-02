import type { BuiltinSkill } from "../../skills/model/skills";
import { t } from "../../../i18n";

export const MCP_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "mcp",
  invocation: "mcp",
  // Soloyard: getter, so the slash menu reads the current language.
  get description() {
    return t("sessions:commands.mcp");
  },
  scope: "builtin",
  source: "monocode",
};

export function isMcpCommand(text: string): boolean {
  return /^\s*\/mcp\s*$/i.test(text);
}
