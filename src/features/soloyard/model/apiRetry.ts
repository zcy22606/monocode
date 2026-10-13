/**
 * Soloyard：Claude Code 自己重试失败的 API 请求时（断网、限流、过载），stream-json 里每次发一条
 * `system/api_retry`。会话里显示一行「网络连接出错，正在重试（第 7/10 次）…」，和终端里一样看得出卡在哪。
 * 用底座带 key 的状态行：同一个 key 原地更新，空文字 = 删掉；请求有了输出或这一轮结束就撤掉。
 */
import { t } from "../../../i18n";
import type { HarnessEvent } from "../../../integrations/harness/core/types";

const KEY = "soloyard.api-retry";

type RetryLive = { apiRetrying: boolean; onEvent: (event: HarnessEvent) => void };

/** 是 `api_retry` 就显示 / 更新那一行，返回 true。 */
export function noteApiRetry(live: RetryLive, rec: Record<string, unknown>): boolean {
  const text = apiRetryText(rec);
  if (text === undefined) return false;
  live.apiRetrying = true;
  live.onEvent({ type: "status", key: KEY, text });
  return true;
}

/** 请求恢复、这一轮结束、进程没了：撤掉那一行。 */
export function clearApiRetry(live: RetryLive): void {
  if (!live.apiRetrying) return;
  live.apiRetrying = false;
  live.onEvent({ type: "status", key: KEY, text: "" });
}

function apiRetryText(rec: Record<string, unknown>): string | undefined {
  if (rec.type !== "system" || rec.subtype !== "api_retry") return undefined;
  const { attempt, max_retries: max } = rec;
  if (typeof attempt !== "number" || typeof max !== "number") return undefined;
  return t("soloyard:apiRetry.retrying", { reason: retryReason(rec), attempt, max });
}

/** `error_status` 是 null = 没拿到 HTTP 响应（断网、连接被重置、超时）。 */
function retryReason(rec: Record<string, unknown>): string {
  const status = typeof rec.error_status === "number" ? rec.error_status : null;
  if (rec.no_response) return t("soloyard:apiRetry.noResponse");
  if (rec.error === "overloaded" || status === 529) return t("soloyard:apiRetry.overloaded");
  if (rec.error === "rate_limit" || status === 429) return t("soloyard:apiRetry.rateLimit");
  if (status === null) return t("soloyard:apiRetry.connection");
  return t("soloyard:apiRetry.status", { status });
}
