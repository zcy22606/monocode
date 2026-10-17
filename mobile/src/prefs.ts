/** 手机上记住的小东西，存 localStorage（键带 `soloyard.mobile.` 前缀）。 */
const KEY = "soloyard.mobile.";

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(KEY + name);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function write(name: string, value: unknown) {
  try {
    localStorage.setItem(KEY + name, JSON.stringify(value));
  } catch {
    // 存不下就算了，下次用默认值
  }
}

export const lastProject = {
  get: () => read<string | null>("project", null),
  set: (id: string) => write("project", id),
};

/** 新会话默认用上次选的模型和设置。 */
export type ModelChoice = { harness: string; model: string; settings: Record<string, string> };
export const lastModel = {
  get: () => read<ModelChoice | null>("model", null),
  set: (choice: ModelChoice) => write("model", choice),
};

/** 每个会话看到哪个时间点为止，用来标「刚跑完、还没看」。 */
const seen = read<Record<string, number>>("seen", {});
export const seenAt = (sessionId: string) => seen[sessionId] ?? 0;
export function markSeen(sessionId: string, updatedAt: number) {
  if ((seen[sessionId] ?? 0) >= updatedAt) return;
  seen[sessionId] = updatedAt;
  write("seen", seen);
}

/** 第一次打开 app 的时间：这之前的会话不算「刚跑完」，免得一装上全是未读。 */
export const installedAt = (() => {
  const at = read<number | null>("installed", null);
  if (at) return at;
  const now = Date.now();
  write("installed", now);
  return now;
})();
