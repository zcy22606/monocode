import type { BuiltinSkill } from "../../skills/model/skills";
import { t } from "../../../i18n";

export const ORCHESTRATOR_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "orchestrator",
  invocation: "orchestrator",
  // IndieDesk: getter, so the slash menu reads the current language.
  get description() {
    return t("sessions:commands.orchestrator");
  },
  scope: "builtin",
  source: "monocode",
};

/** Consume `/orchestrator` when it is used as the leading composer command. */
export function consumeOrchestratorCommand(text: string): {
  text: string;
  matched: boolean;
} {
  const match = text.match(/^\s*\/orchestrator(?=\s|$)\s*/i);
  if (!match) return { text, matched: false };
  return { text: text.slice(match[0].length), matched: true };
}
