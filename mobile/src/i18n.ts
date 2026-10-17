/** 手机端的多语言：跟着手机系统语言走（中文用简体中文，其他用英文）。 */
import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

export const language = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase().startsWith("zh") ? "zh-CN" : "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, "zh-CN": { translation: zh } },
  lng: language,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export { useTranslation };
export const t = i18n.t.bind(i18n);

/** 「Soloyard 0.2.0 · 构建于 10/16 18:40」：手机上对得上装的是哪一版。 */
export const appVersion = () =>
  t("app.version", {
    version: __APP_VERSION__,
    time: new Date(__BUILD_TIME__).toLocaleString(language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
  });

/** 列表里的时间：刚刚 / 3 分钟前 / 10:20 / 昨天 / 10月14日。 */
export function ago(ts: number | undefined, now = Date.now()): string {
  if (!ts) return "";
  const seconds = (now - ts) / 1000;
  if (seconds < 60) return t("time.now");
  if (seconds < 3600) return t("time.minutes", { count: Math.floor(seconds / 60) });
  const date = new Date(ts);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", hour12: false });
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return t("time.yesterday");
  return date.toLocaleDateString(language, { month: "short", day: "numeric" });
}
