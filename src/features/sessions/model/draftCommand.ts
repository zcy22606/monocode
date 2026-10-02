import type { BuiltinSkill } from "../../skills/model/skills";
import { t } from "../../../i18n";

export const DRAFT_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "draft",
  invocation: "draft",
  // IndieDesk: getter, so the slash menu reads the current language.
  get description() {
    return t("sessions:commands.draft");
  },
  scope: "builtin",
  source: "monocode",
};

/** Consume `/draft` when it is used as the leading composer command. */
export function consumeDraftCommand(text: string): {
  text: string;
  matched: boolean;
} {
  const match = text.match(/^\s*\/draft(?=\s|$)\s*/i);
  if (!match) return { text, matched: false };
  return { text: text.slice(match[0].length), matched: true };
}
