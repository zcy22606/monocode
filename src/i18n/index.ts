/**
 * IndieDesk：界面多语言（i18next + react-i18next）。
 *
 * - 翻译在 `locales/<语言>/<命名空间>.json`，一个功能目录一个命名空间；英文是基准，
 *   key 的类型从英文生成（见 `i18next.d.ts`），中文缺 key 由 `locales.test.ts` 拦住。
 * - 组件里用这里导出的 `useTranslation`（保证 i18n 已初始化）；模块级常量不要存翻译好的
 *   文字，存 key，渲染时再翻。
 * - 语言偏好存 localStorage，默认英文；「跟随系统」看 `navigator.languages`。
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

export { Trans, useTranslation } from "react-i18next";

export type Language = "en" | "zh-CN";
export type LanguagePreference = Language | "system";

export const LANGUAGES: Language[] = ["en", "zh-CN"];

/** 语言名用各自的写法，不跟着界面语言变。 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

const KEY = "indiedesk.language";

function loadNamespaces(files: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(files).map(([path, module]) => [
      path.replace(/^.*\/([^/]+)\.json$/, "$1"),
      (module as { default: object }).default,
    ]),
  );
}

const resources = {
  en: loadNamespaces(import.meta.glob("./locales/en/*.json", { eager: true })),
  "zh-CN": loadNamespaces(
    import.meta.glob("./locales/zh-CN/*.json", { eager: true }),
  ),
};

export function loadLanguagePreference(): LanguagePreference {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "system" || LANGUAGES.includes(saved as Language))
      return saved as LanguagePreference;
  } catch {
    // private mode
  }
  return "en";
}

/** 中文一律用简体（繁体还没有翻译，简体比英文更接近）。 */
export function systemLanguage(
  languages: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages,
): Language {
  const first = languages[0]?.toLowerCase() ?? "";
  return first.startsWith("zh") ? "zh-CN" : "en";
}

export function resolveLanguage(preference: LanguagePreference): Language {
  return preference === "system" ? systemLanguage() : preference;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(loadLanguagePreference()),
  fallbackLng: "en",
  defaultNS: "common",
  ns: Object.keys(resources.en),
  interpolation: { escapeValue: false },
  initAsync: false,
});

export const t = i18n.t.bind(i18n);
export { i18n };

function apply() {
  const language = resolveLanguage(loadLanguagePreference());
  if (i18n.language !== language) void i18n.changeLanguage(language);
  document.documentElement.lang = language;
  // 原生菜单、托盘、通知按钮的文字在 Rust 那边（src-tauri/src/i18n.rs）。
  invoke("i18n_set_language", { language }).catch(() => {});
}

export function saveLanguagePreference(preference: LanguagePreference) {
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    // private mode / quota
  }
  apply();
}

/** 每个窗口启动时调一次：同步一次 Rust 端，并跟上系统语言和其他窗口的改动。 */
export function initLanguage() {
  apply();
  window.addEventListener("languagechange", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) apply();
  });
}
