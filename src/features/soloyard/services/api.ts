/**
 * Soloyard：「服务」分页的数据——工作区里监听端口的进程（Rust `soloyard_services.rs`），几秒轮询一次。
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { basename } from "../../../platform/tauri/fs";
import { entryKey, upsertHistory } from "./history";

export type Service = {
  /** 启动进程（`npm run dev` 那一层），停止 / 重启作用于它的整棵进程树。 */
  pid: number;
  ports: number[];
  command: string;
  cwd: string;
  root: string;
  branch: string | null;
  /** 秒级 unix 时间。 */
  startedAt: number;
  logPath: string | null;
  isSelf: boolean;
};

const POLL_MS = 3000;
const bus = new EventTarget();
const refresh = () => bus.dispatchEvent(new Event("refresh"));

export const stopService = (pid: number) => invoke<void>("soloyard_service_stop", { pid }).finally(refresh);

/** 启动 / 重启都记进历史（带日志路径），返回日志路径。 */
async function launched(project: string, cwd: string, command: string, logPath: Promise<string>) {
  try {
    const path = await logPath;
    upsertHistory(project, [{ cwd, command, logPath: path, lastRunAt: Math.floor(Date.now() / 1000) }]);
    return path;
  } finally {
    refresh();
  }
}

export const startService = (project: string, cwd: string, command: string) =>
  launched(project, cwd, command, invoke<string>("soloyard_service_start", { cwd, command }));

export const restartService = (project: string, service: Service) =>
  launched(
    project,
    service.cwd,
    service.command,
    invoke<string>("soloyard_service_restart", { pid: service.pid, cwd: service.cwd, command: service.command }),
  );

export type PackageScript = { dir: string; name: string; script: string; command: string };
export const listPackageScripts = (cwd: string) => invoke<PackageScript[]>("soloyard_package_scripts", { cwd });
export const readServiceLog = (path: string, offset: number) =>
  invoke<{ data: string; offset: number }>("soloyard_service_log", { path, offset });

/** 窗口在前台时轮询；停止 / 重启后立刻重取。看到的服务顺手记进历史。 */
export function useServices(cwd: string) {
  const [services, setServices] = useState<Service[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    if (document.hidden) return;
    invoke<Service[]>("soloyard_services_list", { cwd }).then(
      (list) => {
        setServices(list);
        const now = Math.floor(Date.now() / 1000);
        upsertHistory(cwd, list.filter((service) => !service.isSelf).map((service) => ({ ...service, lastRunAt: now })));
        setError(undefined);
      },
      (raw) => setError(String(raw)),
    );
  }, [cwd]);
  useEffect(() => {
    setServices(undefined);
    load();
    const timer = window.setInterval(load, POLL_MS);
    bus.addEventListener("refresh", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      window.clearInterval(timer);
      bus.removeEventListener("refresh", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [load]);
  return { services, error };
}

/** `node /…/bin/pnpm dev` → `pnpm dev`：路径只留文件名，去掉打头的 node。完整命令放 tooltip。 */
export function shortCommand(command: string): string {
  const parts = command
    .split(" ")
    .filter(Boolean)
    .map((part) => (part.startsWith("/") ? part.slice(part.lastIndexOf("/") + 1) : part));
  return (parts[0] === "node" && parts.length > 1 ? parts.slice(1) : parts).join(" ");
}

export type Uptime = { unit: "s" | "m" | "h" | "d"; count: number };

export function uptime(startedAt: number, nowMs: number): Uptime {
  const secs = Math.max(0, Math.floor(nowMs / 1000) - startedAt);
  if (secs < 60) return { unit: "s", count: secs };
  if (secs < 3600) return { unit: "m", count: Math.floor(secs / 60) };
  if (secs < 86400) return { unit: "h", count: Math.floor(secs / 3600) };
  return { unit: "d", count: Math.floor(secs / 86400) };
}

/** 日志标签和历史都用「目录 + 命令」认服务：重启后 pid 变了，这个不变。 */
export const serviceKey = (service: Service) => entryKey(service);

/** 相对工作区根的子目录，根目录本身是空串。 */
export function relativeDir(cwd: string, root: string): string {
  // lsof 给的是真实路径（/private/tmp），工作区可能是 /tmp。
  for (const base of [root, `/private${root}`]) {
    if (cwd === base) return "";
    if (cwd.startsWith(`${base}/`)) return cwd.slice(base.length + 1);
  }
  return basename(cwd);
}
