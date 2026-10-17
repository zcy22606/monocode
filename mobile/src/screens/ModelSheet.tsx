/** 选模型：新会话、开工、会话里共用。点模型马上生效并关掉；下面的设置点了就改，不关。 */
import type { AgentModel, HostModelCatalog, ModelSetting } from "../host/host";
import type { ModelChoice } from "../prefs";
import { t, useTranslation } from "../i18n";
import type { HarnessId } from "../../../src/features/sessions/model/session";
import { Check, ChevronDown } from "../../../src/shared/ui/icons";
import { HarnessIcon } from "../ui/desktop";
import { Sheet, Spinner, haptic } from "../ui/kit";
import { settingsFor } from "../host/host";

export const HARNESS_NAME: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "OMP",
  fx: "fx",
  hermes: "Hermes Agent",
  antigravity: "Antigravity",
  devin: "Devin",
};

export const providersOf = (catalog?: HostModelCatalog) =>
  Object.entries(catalog?.models ?? {}).filter(([, models]) => models?.length) as [string, AgentModel[]][];

export const findModel = (catalog: HostModelCatalog | undefined, id: string) =>
  providersOf(catalog)
    .flatMap(([, models]) => models)
    .find((m) => m.id === id);

/** 模型的显示名；目录还没拉到时用 id 去掉前缀凑合。 */
export const modelName = (catalog: HostModelCatalog | undefined, id: string) => findModel(catalog, id)?.name ?? id.replace(/^[a-z]+:/, "");

/** 上次选的还在就用它，不然用 Claude Code 的第一个，再不然随便第一个。 */
export function defaultChoice(catalog: HostModelCatalog | undefined, last: ModelChoice | null): ModelChoice | null {
  if (last && findModel(catalog, last.model)) return last;
  const providers = providersOf(catalog);
  const first = (providers.find(([p]) => p === "claude") ?? providers[0])?.[1][0];
  return first ? { harness: first.harness, model: first.id, settings: settingsFor(first) } : null;
}

const settingLabel = (s: ModelSetting) => (s.id === "effort" ? t("model.setting.effort") : s.id === "fast" ? t("model.setting.fast") : s.label);
const KNOWN_VALUES = ["low", "medium", "high", "xhigh", "max", "true", "false"];
const optionLabel = (value: string, label: string) => (KNOWN_VALUES.includes(value) ? t(`model.value.${value}`) : label);

/** 设置里最值得看的那一项（思考强度），跟在模型名后面。 */
export function choiceSummary(catalog: HostModelCatalog | undefined, choice: { model: string; settings: Record<string, string> }) {
  const effort = choice.settings.effort;
  const name = modelName(catalog, choice.model);
  return effort && KNOWN_VALUES.includes(effort) ? `${name} · ${t(`model.value.${effort}`)}` : name;
}

/** 输入框上面的模型标签，照电脑：logo + 模型名 + 思考强度（灰）+ 下拉箭头。 */
export function ModelChip({
  catalog,
  choice,
  onClick,
  disabled,
}: {
  catalog?: HostModelCatalog;
  choice: ModelChoice | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  useTranslation();
  const effort = choice?.settings.effort;
  return (
    <button className="press flex h-8 min-w-0 items-center gap-1.5 rounded-md bg-selection px-2 text-[13px] text-content" disabled={disabled} onClick={onClick}>
      {choice ? (
        <>
          <HarnessIcon harness={choice.harness as HarnessId} className="size-4 shrink-0" />
          <span className="truncate">{modelName(catalog, choice.model)}</span>
          {effort && KNOWN_VALUES.includes(effort) ? <span className="shrink-0 text-content/50">{t(`model.value.${effort}`)}</span> : null}
        </>
      ) : (
        <Spinner size={12} />
      )}
      <ChevronDown className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
    </button>
  );
}

export function ModelSheet({
  open,
  onClose,
  catalog,
  choice,
  onChange,
  lockHarness,
  running,
}: {
  open: boolean;
  onClose: () => void;
  catalog?: HostModelCatalog;
  choice: ModelChoice | null;
  onChange: (choice: ModelChoice, close: boolean) => void;
  /** 会话建好后只能在这个提供方里换。 */
  lockHarness?: string;
  /** 正在跑：换了要等这一轮结束。 */
  running?: boolean;
}) {
  useTranslation();
  const providers = providersOf(catalog);
  const selected = choice ? findModel(catalog, choice.model) : undefined;
  return (
    <Sheet open={open} onClose={onClose} title={t("model.title")}>
      {!catalog ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-content/45">
          <Spinner /> {t("model.loading")}
        </div>
      ) : null}
      {providers.map(([provider, models]) => {
        const locked = !!lockHarness && provider !== lockHarness;
        return (
          <section key={provider} className="mb-1">
            <div className="flex items-center justify-between px-3 pb-1 pt-3 text-xs text-content/40">
              <span className="flex items-center gap-1.5">
                <HarnessIcon harness={provider as HarnessId} className="size-3.5 shrink-0" />
                {HARNESS_NAME[provider] ?? provider}
              </span>
              {locked ? <span>{t("model.locked")}</span> : null}
            </div>
            {models.map((model) => {
              const on = choice?.model === model.id;
              return (
                <button
                  key={model.id}
                  disabled={locked}
                  className={`press press-row flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-opacity disabled:opacity-35 ${on ? "bg-selection" : ""}`}
                  onClick={() => {
                    haptic();
                    onChange({ harness: model.harness, model: model.id, settings: settingsFor(model, choice?.settings) }, true);
                  }}
                >
                  <HarnessIcon harness={model.harness as HarnessId} className="size-4 shrink-0" />
                  <span className="flex-1 text-[15px]">{model.name}</span>
                  {on ? <Check className="size-4 shrink-0 text-content/55" strokeWidth={2} /> : null}
                </button>
              );
            })}
          </section>
        );
      })}
      {selected?.settings?.length && choice ? (
        <div className="mt-2 border-t border-stroke px-3 pt-3">
          {selected.settings.map((setting) => (
            <div key={setting.id} className="mb-3">
              <div className="mb-2 text-xs text-content/40">{settingLabel(setting)}</div>
              <div className="flex flex-wrap gap-2">
                {setting.options.map((option) => {
                  const on = (choice.settings[setting.id] ?? setting.value) === option.value;
                  return (
                    <button
                      key={option.value}
                      className={`press h-8 rounded-full px-3 text-[13px] transition-colors ${on ? "bg-accent text-accent-ink" : "bg-selection text-content/70"}`}
                      onClick={() => {
                        haptic(5);
                        onChange({ ...choice, settings: { ...choice.settings, [setting.id]: option.value } }, false);
                      }}
                    >
                      {optionLabel(option.value, option.label)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {running ? <p className="px-3 pt-1 text-xs leading-relaxed text-content/40">{t("model.afterTurn")}</p> : null}
      {lockHarness ? <p className="px-3 pt-1 text-xs leading-relaxed text-content/40">{t("model.lockedHint")}</p> : null}
    </Sheet>
  );
}
