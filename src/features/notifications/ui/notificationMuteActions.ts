import {
  isProjectMuted,
  NOTIFICATION_MUTE_HOURS,
  type ProjectNotificationPreference,
} from "../model/notificationPreferences";
import { i18n, t } from "../../../i18n";

/** A single status label for the project rail, menus, and mute controls. */
export function notificationMuteStatus(
  preference: ProjectNotificationPreference | undefined,
): string | null {
  if (!preference || !isProjectMuted(preference)) return null;
  return preference.mutedUntil === null
    ? t("mute.status.untilResumed", { ns: "notifications" })
    : t("mute.status.until", {
        ns: "notifications",
        date: new Date(preference.mutedUntil!).toLocaleString(i18n.language, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });
}

/** The same preset IDs and durations are used by project and Inbox menus. */
const mutePresets = [
  ...NOTIFICATION_MUTE_HOURS.map((hours) => ({
    kind: "item" as const,
    id: `mute:${hours}`,
    label: () => t("mute.preset.hours", { ns: "notifications", count: hours }),
    milliseconds: hours * 3_600_000,
  })),
  {
    kind: "item" as const,
    id: "mute:indefinite",
    label: () => t("mute.preset.untilResumed", { ns: "notifications" }),
    milliseconds: null,
  },
  {
    kind: "item" as const,
    id: "mute:custom",
    label: () => t("mute.preset.custom", { ns: "notifications" }),
  },
];

export function notificationMuteActions(now = new Date(Date.now())) {
  return mutePresets.map(({ label: presetLabel, ...action }) => {
    const label = presetLabel();
    if (action.milliseconds == null) return { ...action, label };
    const until = new Date(now.getTime() + action.milliseconds);
    const time = `${until.getHours()}:${String(until.getMinutes()).padStart(2, "0")}`;
    const sameDay = until.toDateString() === now.toDateString();
    return {
      ...action,
      label: t(sameDay ? "mute.preset.at" : "mute.preset.atTomorrow", {
        ns: "notifications",
        label,
        time,
      }),
    };
  });
}

export function notificationMuteDeadline(
  id: string,
): number | null | undefined {
  const action = mutePresets.find((item) => item.id === id);
  if (!action || action.milliseconds === undefined) return undefined;
  return action.milliseconds === null ? null : Date.now() + action.milliseconds;
}
