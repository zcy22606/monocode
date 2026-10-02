import {
  AiIdea,
  CircleDashed,
  CursorMagicSelection,
  MessageSquare,
  Share,
  X,
} from "../../../shared/ui/icons";
import { BTW_COMMAND } from "../model/btw";
import { DRAFT_COMMAND } from "../model/draftCommand";
import { OPERATOR_COMMAND } from "../model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { PLAN_COMMAND } from "../model/plan";
import type { ParseKeys } from "i18next";
import { useTranslation } from "../../../i18n";

// Soloyard: labels below are `sessions` keys, translated where they render.
type Key = ParseKeys<"sessions">;

type ModeCommandStyle = {
  Icon: typeof AiIdea;
  /** Text color of the command inside the prompt. */
  className: string;
  /** Mode pill shown under the prompt while the mode is on. */
  pill?: { label: Key; title: Key; className: string };
  /** Rows that list the mode, such as a + menu or command list. */
  menu?: { label: Key; description: Key; iconClassName: string };
};

export const MODE_COMMAND_STYLES: Record<string, ModeCommandStyle> = {
  [PLAN_COMMAND.name]: {
    Icon: AiIdea,
    className: "text-yellow-700 dark:text-yellow-200/90",
    pill: {
      label: "modes.plan.pill",
      title: "modes.plan.title",
      className:
        "bg-yellow-300/12 text-yellow-700 hover:bg-yellow-300/18 dark:text-yellow-200/90",
    },
    menu: {
      label: "modes.plan.title",
      description: "modes.plan.description",
      iconClassName: "text-yellow-300/80",
    },
  },
  [OPERATOR_COMMAND.name]: {
    Icon: CursorMagicSelection,
    className: "text-sky-700 dark:text-sky-200/90",
    pill: {
      label: "modes.operator.pill",
      title: "modes.operator.title",
      className:
        "bg-sky-500/15 font-medium text-sky-700 hover:bg-sky-500/20 dark:bg-sky-400/10 dark:text-sky-200/90 dark:hover:bg-sky-400/15",
    },
    menu: {
      label: "modes.operator.title",
      description: "modes.operator.description",
      iconClassName: "text-sky-300/80",
    },
  },
  [ORCHESTRATOR_COMMAND.name]: {
    Icon: Share,
    className: "text-fuchsia-700 dark:text-fuchsia-200/90",
    pill: {
      label: "modes.orchestrator.pill",
      title: "modes.orchestrator.title",
      className:
        "bg-fuchsia-500/15 font-medium text-fuchsia-700 hover:bg-fuchsia-500/20 dark:bg-fuchsia-400/10 dark:text-fuchsia-200/90 dark:hover:bg-fuchsia-400/15",
    },
    menu: {
      label: "modes.orchestrator.pill",
      description: "modes.orchestrator.description",
      iconClassName: "text-fuchsia-300/65",
    },
  },
  [DRAFT_COMMAND.name]: {
    Icon: CircleDashed,
    className: "text-content/70",
    pill: {
      label: "modes.draft.pill",
      title: "modes.draft.title",
      className:
        "border border-dashed border-content/25 bg-content/5 text-content/70 hover:bg-content/10 hover:text-content",
    },
    menu: {
      label: "modes.draft.pill",
      description: "modes.draft.description",
      iconClassName: "text-content/60",
    },
  },
  [BTW_COMMAND.name]: {
    Icon: MessageSquare,
    className: "text-emerald-700 dark:text-emerald-200/90",
  },
};

/** First-line indent that, with the `/`, makes room for a mode icon. */
export const MODE_COMMAND_INDENT = "13px";

export type ModeCommandToken = {
  name: string;
  end: number;
  style: ModeCommandStyle;
};

/** Mode commands only take effect at the start of a prompt. */
export function leadingModeCommand(
  text: string,
  names: ReadonlySet<string>,
): ModeCommandToken | null {
  const match = text.match(/^\/([a-z]+)(?=\s|$)/);
  const name = match?.[1];
  if (!match || !name || !names.has(name)) return null;
  const style = MODE_COMMAND_STYLES[name];
  if (!style) return null;
  return { name, end: match[0].length, style };
}

/**
 * The leading command inside a prompt's highlight layer. The `/` keeps its
 * width so the textarea underneath stays in lockstep; the shared first-line
 * indent widens its slot to fit the icon, like the `@` of a file mention.
 */
export function ModeCommandText({
  text,
  mode,
  indent = MODE_COMMAND_INDENT,
  iconClassName = "size-3.5",
}: {
  text: string;
  mode: ModeCommandToken;
  indent?: string;
  iconClassName?: string;
}) {
  return (
    <span className={mode.style.className}>
      <span className="relative">
        <span className="text-transparent">{"/"}</span>
        <mode.style.Icon
          className={`absolute top-1/2 -translate-y-1/2 ${iconClassName}`}
          style={{ left: `-${indent}` }}
        />
      </span>
      <span key={mode.name} className="composer-mode-shimmer">
        {text.slice(1, mode.end)}
      </span>
    </span>
  );
}

export function ModeCommandPill({
  name,
  onClear,
}: {
  name: string;
  onClear: () => void;
}) {
  const { t } = useTranslation("sessions");
  const style = MODE_COMMAND_STYLES[name];
  if (!style?.pill) return null;
  const { Icon, pill } = style;
  return (
    <button
      type="button"
      title={t("modes.turnOff", { mode: t(pill.title) })}
      aria-label={t("modes.turnOff", { mode: t(pill.title) })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClear}
      className={`flex h-6.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] ${pill.className}`}
    >
      <Icon className="size-3.5" />
      <span className="composer-mode-shimmer">{t(pill.label)}</span>
      <X className="size-3" />
    </button>
  );
}
