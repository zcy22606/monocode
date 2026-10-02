/**
 * Soloyard 数据层的前端入口：经 Rust 桥（soloyard_call）调 Node 数据进程。
 * 写完广播刷新；MCP / 其他进程改了库时，数据进程发 soloyard:changed，所有 useSoloyard 一起重取。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

export class SoloyardError extends Error {
  /** 版本冲突时带回的最新一行。 */
  latest?: Record<string, unknown>;
}

export async function soloyardCall<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  try {
    return await invoke<T>("soloyard_call", { method, args });
  } catch (raw) {
    const text = String(raw);
    const error = new SoloyardError(text);
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as { message: string; latest?: Record<string, unknown> };
        error.message = parsed.message;
        error.latest = parsed.latest;
      } catch {
        // 不是结构化错误，保留原文
      }
    }
    throw error;
  }
}

const bus = new EventTarget();
export const refreshSoloyard = () => bus.dispatchEvent(new Event("refresh"));

let listening = false;
function listenForChanges() {
  if (listening) return;
  listening = true;
  void listen("soloyard:changed", refreshSoloyard);
}

/** 写操作：写完立刻刷新（数据进程也会广播，这里先刷让界面不等那一秒）。 */
export async function mutateSoloyard<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const result = await soloyardCall<T>(method, ...args);
  refreshSoloyard();
  return result;
}

/** 读数据并在库变化时自动重取。参数里有 undefined 表示依赖还没到，先不请求。 */
export function useSoloyard<T>(method: string, ...args: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const key = JSON.stringify(args);
  const load = useCallback(() => {
    if (args.some((arg) => arg === undefined)) return;
    soloyardCall<T>(method, ...args).then(
      (value) => {
        setData(value);
        setError(undefined);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key]);
  useEffect(() => {
    listenForChanges();
    load();
    bus.addEventListener("refresh", load);
    return () => bus.removeEventListener("refresh", load);
  }, [load]);
  return { data, error, reload: load };
}

export type SoloyardProject = { id: number; key: string; name: string };

/** 文件夹对应的项目（第一次打开时自动建）。 */
export const useProjectForPath = (cwd: string) => useSoloyard<SoloyardProject>("projectForPath", cwd);
