/**
 * 头脑风暴会话：开在 Soloyard 自己的工作区（应用数据目录下的 workspace/），每次一个子文件夹，
 * 文件夹名默认是开始时间（2026-10-05-1530），发第一条消息前可以改。会话页和新会话完全一样，
 * 只是输入框顶栏的「项目 / 当前检出 / 分支」换成「工作区文件夹」。
 * 每个头脑风暴就是一条想法项目（soloyard/core/src/ideas.ts）：agent 从第一句起维护它的标题、英文名、一句话和 overview。
 * 聊出值得做的方向后「提升为项目」：建项目文件夹 → 会话挪过去接着聊 → 想法项目转成正式项目（立项期）→ 文档收进 docs/
 * → 清理工作文件夹 → 告诉会话里的 agent 已经提升，让它更新 overview、进入立项盘点。
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import { useSyncExternalStore } from "react";
import { t } from "../../../i18n";
import { createPath, deletePath, listDir, movePath, renamePath } from "../../../platform/tauri/fs";
import { mutateSoloyard, soloyardCall } from "../data/api";
import { requestDeleteSession, requestMoveSession, requestSendToSession, requestStartWork } from "./appActions";

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

/** 头脑风暴的想法项目（标题、英文名、一句话由 agent 维护）。 */
export type Idea = {
  id: number;
  path: string;
  name: string;
  slug: string | null;
  goal: string;
  stage: "idea" | "parked" | "killed" | string;
  note: { reason?: string } | null;
  updated_at: string;
};
export const listIdeas = (base: string) => soloyardCall<Idea[]>("ideasUnder", base);
export const isArchived = (idea: Idea | undefined) => idea?.stage === "parked" || idea?.stage === "killed";

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
  await mutateSoloyard("ideaForPath", folder);
  const sessionId = crypto.randomUUID();
  requestStartWork({ cwd: folder, sessionId, prompt });
  return { sessionId, folder };
}

/** 侧栏「头脑风暴」和头脑风暴列表的「+」：提示词跟着界面语言。 */
export const startNewBrainstorm = () => startBrainstorm(t("soloyard:brainstorm.prompt"));

/** 发第一条消息前给工作区文件夹改名：改文件夹，再把会话指过去。 */
export async function renameBrainstormFolder(sessionId: string, cwd: string, name: string) {
  const next = await renamePath(cwd, name);
  await mutateSoloyard("moveIdeaPath", cwd, next);
  try {
    await requestMoveSession({ sessionId, cwd: next });
  } catch (e) {
    await renamePath(next, cwd.replace(/\/+$/, "").split("/").pop() ?? name).catch(() => undefined); // 会话没跟过去就改回来
    await mutateSoloyard("moveIdeaPath", next, cwd).catch(() => undefined);
    throw e;
  }
  return next;
}

export type PromoteStep = "folder" | "session" | "project" | "files" | "cleanup" | "prompt";
export type PromoteInput = { sessionId: string; folder: string; name: string; slug: string; key: string; goal: string; parent: string };
const TEXT_FILE = /\.(md|markdown|txt)$/i;

async function ensureDir(parent: string, name: string) {
  return createPath(parent, name, true).catch((e: unknown) => (exists(e) ? `${parent}/${name}` : Promise.reject(e)));
}

/**
 * 提升为项目。先检查（名称、英文名、前缀、目标文件夹），再按「出错时损失最小」的顺序做：
 * 建空的项目文件夹 → 挪会话（正在运行会被拒绝，这时删掉刚建的空文件夹即可）→ 想法项目转成正式项目
 * → 文档（工作文件夹顶层的 markdown 和 docs/ 里的）挪进项目的 docs/，其余文件挪进 brainstorm/ → 删工作文件夹
 * → 给会话发一条：已经提升，更新 overview，进入立项盘点（等用户点头再跑）。
 */
export async function promoteBrainstorm(input: PromoteInput, onStep: (step: PromoteStep) => void): Promise<{ path: string }> {
  const path = `${input.parent.replace(/\/+$/, "")}/${input.slug}`;
  const fields = { name: input.name.trim(), slug: input.slug, key: input.key, goal: input.goal.trim() };
  const problem = await soloyardCall<string | null>("checkPromote", input.folder, { ...fields, path });
  if (problem) throw new Error(problem);
  onStep("folder");
  await createPath(input.parent, input.slug, true).catch((e: unknown) => {
    throw new Error(exists(e) ? t("soloyard:brainstorm.promoteDialog.folderExists", { path }) : String(e));
  });
  onStep("session");
  try {
    await requestMoveSession({ sessionId: input.sessionId, cwd: path });
  } catch (e) {
    await deletePath(path).catch(() => undefined);
    throw new Error(String(e).includes("busy") ? t("soloyard:brainstorm.promoteDialog.busy") : String(e));
  }
  onStep("project");
  await mutateSoloyard("promoteIdea", input.folder, { ...fields, path });
  onStep("files");
  const docs = await ensureDir(path, "docs");
  for (const entry of (await listDir(input.folder)).filter((e) => !e.name.startsWith("."))) {
    if (entry.isDir && entry.name === "docs") {
      // overview.md 是快照，提升时已经在新文件夹里重新生成了
      for (const doc of (await listDir(entry.path)).filter((d) => d.name !== "overview.md")) await movePath(doc.path, docs);
    } else if (!entry.isDir && TEXT_FILE.test(entry.name)) {
      await movePath(entry.path, docs);
    } else {
      await movePath(entry.path, await ensureDir(path, "brainstorm"));
    }
  }
  onStep("cleanup");
  await deletePath(input.folder);
  onStep("prompt");
  requestSendToSession({ sessionId: input.sessionId, text: t("soloyard:brainstorm.promotedPrompt", { name: fields.name, path, key: fields.key }) });
  return { path };
}

/** 删除头脑风暴：会话、工作文件夹和它的想法项目一起删（调用方已经确认过）。 */
export async function deleteBrainstorm(sessionId: string | null, folder: string) {
  if (sessionId) await requestDeleteSession(sessionId);
  await deletePath(folder);
  await mutateSoloyard("deleteIdea", folder);
}
