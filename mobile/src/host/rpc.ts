/**
 * 和主机说话的唯一出口。手机上走原生层的 `host_rpc`（凭据只在 Rust 里）；
 * 在电脑浏览器里调界面时走开发服务器的 `/__host`（见 vite.config.ts），收发一样。
 */
import { invoke } from "@tauri-apps/api/core";

export type HostErrorKind = "network" | "auth" | "host" | "protocol" | "unpaired";

export class HostError extends Error {
  constructor(
    readonly kind: HostErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type ConnectionInfo = { url: string; environmentId: string; name: string };

export const inTauri = "__TAURI_INTERNALS__" in window;

function toHostError(reason: unknown): HostError {
  if (reason instanceof HostError) return reason;
  const value = reason as { kind?: HostErrorKind; message?: string } | undefined;
  if (value && typeof value === "object" && value.kind) return new HostError(value.kind, value.message ?? "");
  return new HostError("network", String(reason));
}

// 连得上 / 连不上，给顶上的离线提示用。
type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();
let online = true;
function report(next: boolean) {
  if (next === online) return;
  online = next;
  for (const listener of listeners) listener(next);
}
export function onOnlineChange(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const isOnline = () => online;

// 主机不认这台手机了（凭据被吊销、主机重装），App 弹出「重新配对」
const authListeners = new Set<() => void>();
export function onAuthLost(listener: () => void) {
  authListeners.add(listener);
  return () => void authListeners.delete(listener);
}

export async function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    let result: T;
    if (inTauri) {
      result = await invoke<T>("host_rpc", { method, params });
    } else {
      const response = await fetch("/__host", { method: "POST", body: JSON.stringify({ method, params }) });
      const body = await response.json();
      if (!response.ok) throw body;
      result = body as T;
    }
    report(true);
    return result;
  } catch (reason) {
    const error = toHostError(reason);
    if (error.kind === "network") report(false);
    if (error.kind === "auth") for (const listener of authListeners) listener();
    throw error;
  }
}

export async function currentConnection(): Promise<ConnectionInfo | null> {
  if (inTauri) return invoke<ConnectionInfo | null>("connection");
  // 浏览器里调界面：开发服务器已经带着凭据，问一下主机是谁就算配好了
  const host = await rpc<{ environmentId: string; name: string }>("environment.describe").catch(() => null);
  return host && { url: "http://127.0.0.1:3774", environmentId: host.environmentId, name: host.name };
}

export async function pair(url: string, token: string): Promise<ConnectionInfo> {
  if (!inTauri) throw new HostError("unpaired", "Pairing runs in the app");
  try {
    return await invoke<ConnectionInfo>("pair", { url, token });
  } catch (reason) {
    throw toHostError(reason);
  }
}

export async function forget(): Promise<void> {
  if (inTauri) await invoke("forget");
}
