/**
 * 头脑风暴 = 想法期的项目（soloyard/core/src/ideas.ts）。它和别的项目唯一的区别是文件夹放在应用数据目录的
 * workspace/ 下（每个想法一个子文件夹，默认按开始时间命名，方便统一清理）。会话、项目面板、概览都是项目的那一套。
 * 这里只管三件事：
 * - 新想法：建文件夹 → 建想法项目 → 开会话，并把它记成当前项目；
 * - 想法 → 项目栏：想法进「头脑风暴」分组，标题（agent 经 update_overview 维护）同步成项目栏里的名字，搁置 / 放弃 = 归档项目；
 * - 提升为项目：文件夹挪到用户选的位置、阶段改成立项、项目栏里的记录跟着搬，再告诉会话里的 agent 进入立项。
 */
import { appDataDir, join } from "@tauri-apps/api/path";
import { useEffect, useSyncExternalStore } from "react";
import { t } from "../../../i18n";
import { createPath, deletePath, listDir, movePath, renamePath } from "../../../platform/tauri/fs";
import { projectKey } from "../../../shared/lib/paths";
import {
  archiveProject, loadArchivedProjects, loadRecents, notifyProjectPathsChanged, rememberProject, replaceProjectPath, sameProjectPath,
} from "../../projects/model/recents";
import {
  loadProjectGroupAssignments, loadProjectGroups, rebaseProjectGroupAssignment, removeProjectGroupAssignment, saveProjectGroups, setProjectGroupAssignment,
} from "../../projects/model/projectGroups";
import { loadTabGroupLabels, rebaseProjectTabGroupSettings, saveTabGroupLabel } from "../../workspace/model/tabGroups";
import { mutateSoloyard, soloyardCall } from "../data/api";
import { requestMoveSession, requestSendToSession, requestStartWork } from "./appActions";

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

/** 头脑风暴的文件夹：工作区下的子文件夹（输入框顶栏据此换成「工作区文件夹」和「提升为项目」）。 */
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

/** 想法项目（标题、英文名、一句话由 agent 维护；stage 是 idea，归档后是 parked / killed）。 */
export type Idea = { id: number; path: string; name: string; slug: string | null; goal: string; stage: string; note: { reason?: string } | null; updated_at: string };
export const listIdeas = (base: string) => soloyardCall<Idea[]>("ideasUnder", base);

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

// ───────────── 想法 → 项目栏 ─────────────

/**
 * 项目栏里的「头脑风暴」分组：想法期的项目归在这里，提升后移出。
 * 第一次有想法时（点「新想法」，或启动时同步到已有的想法）建一次；用户把它删了，后台同步不会再建回来，想法就留在「项目」里。
 */
export const IDEAS_GROUP_ID = "soloyard-ideas";
const GROUP_MADE_KEY = "soloyard.ideasGroupMade";

export function ensureIdeasGroup() {
  localStorage.setItem(GROUP_MADE_KEY, "1");
  const groups = loadProjectGroups();
  if (groups.some((g) => g.id === IDEAS_GROUP_ID)) return;
  saveProjectGroups([{ id: IDEAS_GROUP_ID, name: t("soloyard:ideas.group"), collapsed: false }, ...groups]);
}

/** 想法进项目栏：分组还在就归进「头脑风暴」，项目栏里显示它的标题（不是文件夹名）。 */
function adoptIdea(path: string, name: string) {
  const grouped = loadProjectGroups().some((g) => g.id === IDEAS_GROUP_ID);
  if (grouped && loadProjectGroupAssignments()[projectKey(path)] !== IDEAS_GROUP_ID) setProjectGroupAssignment(path, IDEAS_GROUP_ID);
  if (loadTabGroupLabels()[projectKey(path)] !== name) saveTabGroupLabel(projectKey(path), name);
}

/** 文件夹改名 / 提升搬家后，项目栏里的记录（最近项目、顺序、置顶、分组、名字和外观）跟着搬。 */
function rebaseIdeaPath(from: string, to: string) {
  replaceProjectPath(from, to);
  rebaseProjectGroupAssignment(from, to);
  rebaseProjectTabGroupSettings(from, to);
}

/** 上次同步时每个想法的标题和阶段：只在变了时动项目栏，不和用户在项目栏里自己做的改名、归档打架。 */
const seen = new Map<number, { name: string; stage: string }>();

/** 把想法项目的变化同步到项目栏：标题、分组；搁置 / 放弃 = 归档项目，恢复 = 回到项目栏。 */
export function syncIdeas(ideas: Idea[]) {
  const inRail = (p: string) => loadRecents().some((r) => sameProjectPath(r.path, p));
  const archived = (p: string) => loadArchivedProjects().some((r) => sameProjectPath(r.path, p));
  let changed = false;
  if (!localStorage.getItem(GROUP_MADE_KEY) && ideas.some((i) => i.stage === "idea")) ensureIdeasGroup();
  for (const idea of ideas) {
    const prev = seen.get(idea.id);
    seen.set(idea.id, { name: idea.name, stage: idea.stage });
    const live = idea.stage === "idea";
    const name = idea.name || t("soloyard:overview.untitled");
    if (prev === undefined) {
      // 第一次看到（启动或新建）：没进过项目栏的进去；用户归档过的不动
      if (live && !inRail(idea.path) && !archived(idea.path)) {
        rememberProject(idea.path);
        changed = true;
      }
      if (live && inRail(idea.path)) adoptIdea(idea.path, name);
      continue;
    }
    if (prev.name !== idea.name && inRail(idea.path)) adoptIdea(idea.path, name);
    if (prev.stage !== idea.stage) {
      if (!live && inRail(idea.path)) archiveProject(idea.path);
      if (live && archived(idea.path)) {
        rememberProject(idea.path);
        adoptIdea(idea.path, name);
      }
      changed = true;
    }
  }
  if (changed) notifyProjectPathsChanged();
}

/** 挂在一直存在的侧栏入口上：每 5 秒把想法的变化同步进项目栏（agent 改标题、用户在概览页归档都走这里）。 */
export function useIdeaSync() {
  const base = useBrainstormRoot();
  useEffect(() => {
    if (!base) return;
    let alive = true;
    const tick = () => void listIdeas(base).then((ideas) => alive && syncIdeas(ideas)).catch(() => undefined);
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [base]);
}

/**
 * 项目栏里对一个想法做「移除」或「归档」时（App 的 onRemoveProject）：
 * - 移除：底座已经删掉它在应用里的会话；想法的文件夹在应用自己的 workspace/ 里，没有别的用处，连文件夹和想法记录一起删掉；
 * - 归档：想法标成「搁置」，概览页和项目栏说的是同一件事。
 */
export async function onIdeaRemoved(path: string, purge: boolean) {
  if (purge) {
    await deletePath(path).catch(() => undefined);
    await mutateSoloyard("deleteIdea", path).catch(() => undefined);
    return;
  }
  const idea = await soloyardCall<{ id: number; stage: string } | null>("findProjectByPath", path).catch(() => null);
  if (idea?.stage === "idea") await mutateSoloyard("setProjectStage", idea.id, "parked").catch(() => undefined);
}

// ───────────── 新想法 ─────────────

/**
 * 开始新的头脑风暴 = 新建一个想法期的项目。反复点不留一堆空文件夹：已经有一个空的、还没有会话的头脑风暴文件夹就接着用它，
 * 否则按开始时间新建（重名加 -2、-3）。然后建想法项目、归进「头脑风暴」分组，在里面开一个会话并把它记成当前项目。
 * 输入框留空给用户说想法；头脑风暴的规矩由系统提示带上（core 的 brainstormGuide）。
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
  const idea = await mutateSoloyard<Idea>("ideaForPath", folder);
  seen.set(idea.id, { name: idea.name, stage: idea.stage });
  ensureIdeasGroup();
  adoptIdea(folder, idea.name || t("soloyard:overview.untitled"));
  const sessionId = crypto.randomUUID();
  requestStartWork({ cwd: folder, sessionId, prompt, remember: true });
  return { sessionId, folder };
}

/** 侧栏的「新想法」和旧标签上的入口。 */
export const startNewBrainstorm = () => startBrainstorm("");

/** 发第一条消息前给工作区文件夹改名：改文件夹，再把会话和项目栏里的记录指过去。 */
export async function renameBrainstormFolder(sessionId: string, cwd: string, name: string) {
  const next = await renamePath(cwd, name);
  await mutateSoloyard("moveIdeaPath", cwd, next);
  rebaseIdeaPath(cwd, next);
  try {
    await requestMoveSession({ sessionId, cwd: next });
  } catch (e) {
    await renamePath(next, cwd.replace(/\/+$/, "").split("/").pop() ?? name).catch(() => undefined); // 会话没跟过去就改回来
    await mutateSoloyard("moveIdeaPath", next, cwd).catch(() => undefined);
    rebaseIdeaPath(next, cwd);
    throw e;
  }
  return next;
}

// ───────────── 提升为项目 ─────────────

export type PromoteStep = "folder" | "session" | "project" | "files" | "cleanup" | "prompt";
export type PromoteInput = { sessionId: string; folder: string; name: string; slug: string; key: string; goal: string; parent: string };
const TEXT_FILE = /\.(md|markdown|txt)$/i;

async function ensureDir(parent: string, name: string) {
  return createPath(parent, name, true).catch((e: unknown) => (exists(e) ? `${parent}/${name}` : Promise.reject(e)));
}

/**
 * 提升为项目。先检查（名称、英文名、前缀、目标文件夹），再按「出错时损失最小」的顺序做：
 * 建空的项目文件夹 → 挪会话（正在运行会被拒绝，这时删掉刚建的空文件夹即可）→ 想法项目转成正式项目（阶段：立项）
 * → 文档（工作文件夹顶层的 markdown 和 docs/ 里的）挪进项目的 docs/，其余文件挪进 brainstorm/ → 删工作文件夹，
 * 项目栏里的记录搬到新路径并移出「头脑风暴」分组 → 给会话发一条：已经提升，更新 overview，进入立项盘点（等用户点头再跑）。
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
  rebaseIdeaPath(input.folder, path);
  removeProjectGroupAssignment(path);
  saveTabGroupLabel(projectKey(path), fields.name);
  notifyProjectPathsChanged();
  onStep("prompt");
  requestSendToSession({ sessionId: input.sessionId, text: t("soloyard:brainstorm.promotedPrompt", { name: fields.name, path, key: fields.key }) });
  return { path };
}
