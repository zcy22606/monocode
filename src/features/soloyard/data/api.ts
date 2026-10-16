/**
 * Soloyard 数据层的前端入口：经 Rust 桥（soloyard_call）调 Node 数据进程。
 * 写完广播刷新；MCP / 其他进程改了库时，数据进程发 soloyard:changed，所有 useSoloyard 一起重取。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

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

// 每个打开的会话（包括藏起来的标签）都挂着几个 useSoloyard，一次刷新就是几百个请求、几百次重渲染。
// 同样的请求只发一个；结果和上次一样就给同一个对象，React 不重渲染。
// ponytail: latest 不清理，键数 ≈ 会话数 × 方法数，很小
const inflight = new Map<string, Promise<unknown>>();
const latest = new Map<string, { json: string; value: unknown }>();

function sharedCall<T>(method: string, args: unknown[]): Promise<T> {
  const id = `${method}:${JSON.stringify(args)}`;
  let pending = inflight.get(id);
  if (!pending) {
    pending = soloyardCall(method, ...args)
      .then((value) => {
        const json = JSON.stringify(value);
        const previous = latest.get(id);
        if (previous?.json === json) return previous.value;
        latest.set(id, { json, value });
        return value;
      })
      .finally(() => {
        if (inflight.get(id) === pending) inflight.delete(id);
      });
    inflight.set(id, pending);
  }
  return pending as Promise<T>;
}

const bus = new EventTarget();
export const refreshSoloyard = () => {
  inflight.clear(); // 刷新之后的读不能接上变更前发出的请求
  bus.dispatchEvent(new Event("refresh"));
};

let listening = false;
function listenForChanges() {
  if (listening) return;
  listening = true;
  listen("soloyard:changed", refreshSoloyard).catch(() => {
    listening = false; // 测试环境没有 Tauri
  });
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
  const shown = useRef<{ data?: T; error?: string }>({});
  const key = JSON.stringify(args);
  const load = useCallback(() => {
    if (args.some((arg) => arg === undefined)) return;
    sharedCall<T>(method, args).then(
      (value) => {
        if (value === shown.current.data && shown.current.error === undefined) return; // 没变，连组件函数都不跑
        shown.current = { data: value };
        setData(value);
        setError(undefined);
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        shown.current = { ...shown.current, error: message };
        setError(message);
      },
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
