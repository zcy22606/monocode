/**
 * 头脑风暴会话：开在 Soloyard 自己的工作区（应用数据目录下的 workspace/），每次一个子文件夹，
 * 文件夹名默认是开始时间（2026-10-05-1530），发第一条消息前可以改。会话页和新会话完全一样，
 * 只是输入框顶栏的「项目 / 当前检出 / 分支」换成「工作区文件夹」。
 * 聊出值得做的方向后「提升为项目」：建项目文件夹和项目 → 会话挪过去接着聊 → 产物收进项目 → 清理工作文件夹。
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import { useSyncExternalStore } from "react";
import { t } from "../../../i18n";
import { createPath, deletePath, listDir, movePath, readTextFile, renamePath } from "../../../platform/tauri/fs";
import { mutateSoloyard, soloyardCall } from "../data/api";
import { requestDeleteSession, requestMoveSession, requestStartWork } from "./appActions";

let root: string | null = null;
const listeners = new Set<() => void>();
const rootReady = (async () => {
  try {
    root = (await join(await appDataDir(), "workspace")).replace(/\/+$/, "");
    listeners.forEach((l) => l());
  } catch {
    // 不在 Tauri 里（单测）：没有工作区
  }
})();

/** 文件夹名规则和项目文件夹一样：不含空格和中文，命令行、git、各种工具都不出问题。 */
export const FOLDER_NAME = /^[A-Za-z0-9._-]+$/;

/** 开始时间做默认名：2026-10-05-1530。 */
export function defaultFolderName(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export const isBrainstormCwd = (cwd: string | undefined, base = root) => !!base && !!cwd && cwd.replace(/\/+$/, "").startsWith(`${base}/`);

/** 工作区根目录（解析出来前是 null），解析完重新渲染。 */
export const useBrainstormRoot = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => root);

/** 应用刚启动时恢复的头脑风暴会话也能认出来：根目录解析完会重新渲染。 */
export function useIsBrainstormCwd(cwd: string | undefined) {
  return isBrainstormCwd(cwd, useBrainstormRoot());
}

export type BrainstormSession = { id: string; cwd: string; harness: string; title: string | null; updated_at: number };
/** 工作区下的头脑风暴会话（发过消息的才入库）。 */
export const listBrainstormSessions = (base: string) => soloyardCall<BrainstormSession[]>("sessionsUnder", base);

const exists = (e: unknown) => /exist/i.test(String(e));

async function workspaceRoot() {
  await rootReady;
  if (!root) throw new Error("brainstorm workspace unavailable");
  try {
    await createPath(root.slice(0, root.lastIndexOf("/")), "workspace", true);
  } catch (e) {
    if (!exists(e)) throw e;
  }
  return root;
}

/**
 * 开始新的头脑风暴。反复点不留一堆空文件夹：已经有一个空的、还没有会话的头脑风暴文件夹就接着用它，
 * 否则按开始时间新建（重名加 -2、-3）。会话开在里面，头脑风暴提示词预填进输入框。
 */
export async function startBrainstorm(prompt: string): Promise<{ sessionId: string; folder: string }> {
  const base = await workspaceRoot();
  const [entries, sessions] = await Promise.all([listDir(base), listBrainstormSessions(base)]);
  const used = new Set(sessions.map((s) => s.cwd.replace(/\/+$/, "")));
  let folder = "";
  for (const entry of entries.filter((e) => e.isDir && !used.has(e.path.replace(/\/+$/, ""))).sort((a, b) => b.name.localeCompare(a.name))) {
    if (!(await listDir(entry.path)).length) {
      folder = entry.path;
      break;
    }
  }
  for (let n = 1; !folder; n++) {
    const name = n === 1 ? defaultFolderName() : `${defaultFolderName()}-${n}`;
    try {
      folder = await createPath(base, name, true);
    } catch (e) {
      if (!exists(e) || n > 50) throw e;
    }
  }
  const sessionId = crypto.randomUUID();
  requestStartWork({ cwd: folder, sessionId, prompt });
  return { sessionId, folder };
}

/** 侧栏「头脑风暴」和头脑风暴列表的「+」：提示词跟着界面语言。 */
export const startNewBrainstorm = () => startBrainstorm(t("soloyard:brainstorm.prompt"));

/** 发第一条消息前给工作区文件夹改名：改文件夹，再把会话指过去。 */
export async function renameBrainstormFolder(sessionId: string, cwd: string, name: string) {
  const next = await renamePath(cwd, name);
  try {
    await requestMoveSession({ sessionId, cwd: next });
  } catch (e) {
    await renamePath(next, cwd.replace(/\/+$/, "").split("/").pop() ?? name).catch(() => undefined); // 会话没跟过去就改回来
    throw e;
  }
  return next;
}

export type PromoteStep = "folder" | "session" | "project" | "files" | "cleanup";
const TEXT_FILE = /\.(md|markdown|txt)$/i;

/**
 * 提升为项目。顺序按「出错时损失最小」排：先建空的项目文件夹，再挪会话（正在运行会被拒绝，这时删掉刚建的空文件夹即可），
 * 然后建 Soloyard 项目、收产物（markdown / 文本进项目文档，其余文件挪进项目的 brainstorm/ 目录），最后删工作文件夹。
 */
export async function promoteBrainstorm(
  input: { sessionId: string; folder: string; name: string; parent: string; dirName: string },
  onStep: (step: PromoteStep) => void,
): Promise<{ path: string; projectId: number }> {
  onStep("folder");
  const path = await createPath(input.parent, input.dirName, true).catch((e: unknown) => {
    throw new Error(exists(e) ? t("soloyard:brainstorm.promoteDialog.folderExists", { path: `${input.parent}/${input.dirName}` }) : String(e));
  });
  onStep("session");
  try {
    await requestMoveSession({ sessionId: input.sessionId, cwd: path });
  } catch (e) {
    await deletePath(path).catch(() => undefined);
    throw new Error(String(e).includes("busy") ? t("soloyard:brainstorm.promoteDialog.busy") : String(e));
  }
  onStep("project");
  const projectId = await mutateSoloyard<number>("createProjectAt", input.name, path);
  onStep("files");
  const entries = (await listDir(input.folder)).filter((e) => !e.name.startsWith("."));
  for (const entry of entries) {
    if (!entry.isDir && TEXT_FILE.test(entry.name)) {
      const body = await readTextFile(entry.path);
      await mutateSoloyard("addDocument", projectId, { title: entry.name.replace(TEXT_FILE, ""), body_md: body });
    } else {
      const keep = await createPath(path, "brainstorm", true).catch((e: unknown) => (exists(e) ? `${path}/brainstorm` : Promise.reject(e)));
      await movePath(entry.path, keep);
    }
  }
  onStep("cleanup");
  await deletePath(input.folder);
  return { path, projectId };
}

/** 删除头脑风暴：会话和工作文件夹一起删（调用方已经确认过）。 */
export async function deleteBrainstorm(sessionId: string | null, folder: string) {
  if (sessionId) await requestDeleteSession(sessionId);
  await deletePath(folder);
}
