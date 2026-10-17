/**
 * 会话里的文件（SOL-92）：原生层经网关去文件所在的机器取，存进手机缓存（mobile/src-tauri/src/files.rs）。
 * 界面里用 `soloyardfile` 地址加载（图片、网页和它的资源、文本），分享 / 用其他应用打开 / 存到手机交给安卓（MainActivity.kt）。
 */
import { createContext, useContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import { absolutePath } from "../../../soloyard/core/src/session-files";
import { t } from "../i18n";
import { useNav } from "../ui/nav";
import { HostError } from "./rpc";
import { openLocalService } from "./host";
import { toast } from "../ui/kit";

/** mirror = 电脑上的会话，host = 主机上的会话；cwd 是相对路径的起点（有工作树就是工作树）。 */
export type FileSource = { source: "mirror" | "host"; id: string; cwd: string };
export type FileInfo = { name: string; mime: string; size: number; mtime: number; path: string; local: string };

export const FileSourceContext = createContext<FileSource | null>(null);

/** 给人看的路径：home 缩成 ~（手机不知道电脑的 home，按 /Users/<名字>、/home/<名字> 认）。 */
export const shortPath = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");

export const toAbsolute = (path: string, cwd: string) => absolutePath(path.replace(/^file:\/\//, ""), cwd);

/** 安卓上自定义协议是 http://<协议>.localhost；路径一段段编码，网页里的相对路径才解析得对。 */
export function fileUrl(source: Omit<FileSource, "cwd">, path: string) {
  const rest = path.replace(/^\//, "").split("/").map(encodeURIComponent).join("/");
  return `http://soloyardfile.localhost/${source.source === "host" ? "h" : "m"}/${encodeURIComponent(source.id)}/${rest}`;
}

/** 在会话页里：打开会话里的一个文件（相对路径按会话目录算）。不在会话页里是 undefined。 */
export function useOpenFile() {
  const source = useContext(FileSourceContext);
  const nav = useNav();
  if (!source) return undefined;
  return (path: string) => nav.push({ name: "file", source: source.source, id: source.id, path: toAbsolute(path, source.cwd) });
}

/** 本地服务的网址（localhost / 127.0.0.1 / 0.0.0.0 加端口）→ 端口和路径；不是就 undefined。 */
export function localService(href: string) {
  const m = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d+))?(\/[^\s]*)?$/i.exec(href.trim());
  return m ? { port: Number(m[1] ?? 80), path: m[2] ?? "/" } : undefined;
}

/** 在会话页里：打开会话所在机器上的一个本地服务（那台机器先开好转发）。不在会话页里是 undefined。 */
export function useOpenService() {
  const source = useContext(FileSourceContext);
  const nav = useNav();
  if (!source) return undefined;
  return (port: number, path = "/") =>
    openLocalService(source.source, source.id, port).then(
      ({ url }) => nav.push({ name: "web", url: url + path, port }),
      (e) => toast(fileError(e)),
    );
}

export async function fileInfo(source: Omit<FileSource, "cwd">, path: string) {
  try {
    return await invoke<FileInfo>("file_info", { source: source.source, id: source.id, path });
  } catch (reason) {
    const e = reason as { kind?: string; message?: string };
    throw new HostError((e.kind as HostError["kind"]) ?? "host", e.message ?? String(reason));
  }
}

/** 网关 / 电脑给的英文原因换成给人看的话。 */
export function fileError(e: unknown) {
  const error = e instanceof HostError ? e : new HostError("host", String(e));
  if (error.kind === "network") return t("files.error.network");
  const known: [RegExp, string][] = [
    [/offline/i, "files.error.offline"],
    [/did not answer/i, "files.error.timeout"],
    [/Credential/i, "files.error.secret"],
    [/not part of the session/i, "files.error.outside"],
    [/Nothing in this project/i, "files.error.notListening"],
    [/Tailscale is not running/i, "files.error.noTailscale"],
    [/larger than/i, "files.error.tooBig"],
    [/not found|Not a file/i, "files.error.notFound"],
  ];
  const hit = known.find(([re]) => re.test(error.message));
  return hit ? t(hit[1]) : error.message;
}

type Bridge = { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null };

/**
 * 调安卓原生（MainActivity.kt）：回 "ok"、"ok:<数据>" 或 "error:<原因>"。桥只有一个 onmessage，一次只发一个，排着队来。
 */
let queue: Promise<unknown> = Promise.resolve();
export function androidCall(message: Record<string, unknown>): Promise<string> {
  const bridge = (window as unknown as { SoloyardAndroid?: Bridge }).SoloyardAndroid;
  if (!bridge) return Promise.reject(new Error(t("files.error.unsupported")));
  const run = () =>
    new Promise<string>((ok, fail) => {
      bridge.onmessage = (event) => {
        bridge.onmessage = null;
        if (event.data === "ok" || event.data.startsWith("ok:")) ok(event.data.slice(3));
        else fail(new Error(event.data.replace(/^error:/, "")));
      };
      bridge.postMessage(JSON.stringify(message));
    });
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** 交给安卓：share 分享、open 用其他应用打开、save 存到「下载」、browse 用浏览器打开网址。 */
export function android(action: "share" | "open" | "save", file: FileInfo): Promise<void>;
export function android(action: "browse", url: string): Promise<void>;
export function android(action: string, target: FileInfo | string) {
  return androidCall(typeof target === "string" ? { action, url: target } : { action, path: target.local, mime: target.mime }).then(() => undefined);
}

/** 看起来像文件路径的行内代码（照电脑 fileLinks.ts 的 inlinePath，只要文件，不要文件夹）。 */
export function looksLikeFile(text: string) {
  const value = text.trim();
  if (!value || value.length > 240 || /\s/.test(value) || value.includes("://")) return undefined;
  const bare = value.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  const name = bare.split("/").filter(Boolean).pop() ?? "";
  return !bare.endsWith("/") && /\.[A-Za-z][A-Za-z0-9+-]{0,11}$/.test(name) ? bare : undefined;
}
