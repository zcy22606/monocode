/**
 * 主机上的项目、会话、模型和命令。协议类型直接用桌面端的
 * `src/features/connections/model/protocol.ts`（纯 TS，只按类型引用桌面代码）。
 */
import {
  applySessionSync,
  type CommandReceipt,
  type HostCommand,
  type HostDirectory,
  type HostModelCatalog,
  type HostProject,
  type HostSession,
  type HostSessionSummary,
  type RemoteProvider,
  type SessionSync,
  type SessionSyncChunk,
  type SessionSyncResponse,
} from "../../../src/features/connections/model/protocol";
import type { BackgroundJob, Block, RuntimeMode, Session } from "../../../src/features/sessions/model/session";
import type { AgentModel, ModelSetting } from "../../../src/features/sessions/model/models";
import type { SessionFile } from "../../../soloyard/core/src/session-files";
import type { UserQuestion, UserQuestionReply } from "../../../src/features/sessions/model/userQuestion";
import { rpc } from "./rpc";

export type {
  AgentModel,
  Block,
  HostDirectory,
  HostModelCatalog,
  HostProject,
  HostSession,
  HostSessionSummary,
  ModelSetting,
  RemoteProvider,
  RuntimeMode,
  Session,
  UserQuestion,
  UserQuestionReply,
};

export const listProjects = () => rpc<HostProject[]>("projects.list");
export const openProject = (cwd: string) => rpc<HostProject>("projects.open", { cwd });
export const browse = (path?: string) => rpc<HostDirectory>("projects.browse", path ? { path } : {});
export const listSessions = (projectId: string) => rpc<HostSessionSummary[]>("sessions.list", { projectId });
export const listModels = (projectId: string) => rpc<HostModelCatalog>("models.list", { projectId });

// ---------- 电脑上的会话（网关的会话镜像，见 soloyard/host/gateway.ts） ----------
export type MirrorSummary = {
  id: string;
  machine: string;
  cwd: string;
  title: string;
  harness: string;
  model: string;
  branch: string | null;
  updatedAt: number;
  pushedAt: number;
  revision: number;
  /** 已经在主机上接着聊了：主机会话 id。 */
  continuedAs?: string;
  /** 电脑上这一轮正在跑。 */
  busy?: boolean;
  /** 这台电脑上的 Soloyard 开着（发的消息它能接）。 */
  online?: boolean;
};
export type MirrorSession = Omit<MirrorSummary, "title"> & {
  providerSessionId: string | null;
  totalBlocks: number;
  session: Session;
  /** 电脑上的 Soloyard 开着：发的消息交给电脑跑。 */
  online?: boolean;
  /** 还在后台跑的任务（任何一轮起的，SOL-99）。 */
  jobs?: BackgroundJob[];
};

/** 主机上这个项目对应的仓库，在电脑上有哪些会话。直连 monocode-host（没有网关）时会报错，调用方当成没有。 */
export const listMirror = (cwd: string) => rpc<MirrorSummary[]>("soloyard.mirror.list", { cwd });
/** 会话目录里的进程在监听的端口（电脑上的问电脑，主机上的问主机，SOL-97）。 */
export type LocalService = { port: number; command: string; pid: number };
export const listServices = (source: "mirror" | "host", id: string) => rpc<LocalService[]>("soloyard.services.list", { source, id });
/** 打开一个：那台机器在它的 Tailscale 地址上开好转发，回手机能直接连的地址。 */
export const openLocalService = (source: "mirror" | "host", id: string, port: number) => rpc<{ url: string }>("soloyard.services.open", { source, id, port });
/** 电脑上这个会话写过、改过、生成过的文件（网关按整份对话算）。 */
export const mirrorFiles = (id: string) => rpc<SessionFile[]>("soloyard.mirror.files", { id });
/** tail = 只要最后几块；带上次的 revision，没变就回 unchanged。 */
export const getMirror = (id: string, revision?: number, tail?: number) =>
  rpc<MirrorSession | { unchanged: true; revision: number; continuedAs?: string; online?: boolean; busy?: boolean; jobs?: BackgroundJob[] }>(
    "soloyard.mirror.get",
    { id, revision, tail },
  );
/** 发给电脑上的会话：电脑开着就排进它的收件箱（relayed），不然返回 false。commandId 重发不重复。 */
export const relayMirror = (id: string, text: string, commandId: string) =>
  rpc<{ relayed: boolean }>("soloyard.mirror.send", { id, text, commandId });
/** 停掉电脑上这个会话的一个后台任务（交给电脑去停，停了以后它从列表里消失）。 */
export const stopMirrorJob = (id: string, jobId: string) =>
  rpc<{ relayed: boolean }>("soloyard.mirror.stopJob", { id, jobId, commandId: crypto.randomUUID() });

/** 读一次同步，主机分块发时拼起来。 */
async function sync(sessionId: string, revision?: number): Promise<SessionSync> {
  const response = await rpc<SessionSyncResponse>("sessions.sync", { sessionId, revision });
  if (response.kind !== "chunked") return response;
  let text = "";
  while (text.length < response.length) {
    const { data } = await rpc<SessionSyncChunk>("sessions.syncChunk", {
      sessionId,
      transfer: response.transfer,
      offset: text.length,
    });
    if (!data) throw new Error("Session transfer ended early");
    text += data;
  }
  return JSON.parse(text) as SessionSync;
}

/** 只拿上次之后变了的块；对不上就整份重拉。 */
export async function loadSession(sessionId: string, known?: HostSession): Promise<HostSession> {
  try {
    return applySessionSync(known, await sync(sessionId, known?.revision));
  } catch {
    return applySessionSync(undefined, await sync(sessionId));
  }
}

const dispatch = (command: HostCommand) => rpc<CommandReceipt>("commands.dispatch", command as unknown as Record<string, unknown>);
const id = (): string => crypto.randomUUID();

export type Draft = { harness: RemoteProvider; model: string; settings: Record<string, string>; mode: RuntimeMode };

/** 建一个空会话，返回它的 id；第一条消息另外 `send`（发失败可以单独重发）。 */
export async function createSession(projectId: string, draft: Draft) {
  const created = await dispatch({
    type: "create",
    commandId: id(),
    projectId,
    harness: draft.harness,
    model: draft.model,
    modelSettings: draft.settings,
    runtimeMode: draft.mode,
  });
  return created.sessionId;
}

/** commandId 也是主机上那条消息块的 id：乐观显示的消息和主机回来的那条对得上。
 *  主机在一轮跑着时会拒绝（This session is already running），调用方先排队。 */
export const send = (sessionId: string, text: string, commandId = id()) =>
  dispatch({ type: "send", commandId, sessionId, text, attachments: [], intent: "default" });

export const stop = (sessionId: string, runId: string) => dispatch({ type: "cancel", commandId: id(), sessionId, runId });

export const approve = (sessionId: string, runId: string, requestId: number, decision: "allow" | "deny") =>
  dispatch({ type: "approve", commandId: id(), sessionId, runId, requestId, decision });

export const answer = (sessionId: string, runId: string, requestId: number, reply: UserQuestionReply) =>
  dispatch({ type: "answer", commandId: id(), sessionId, runId, requestId, reply });

/** 改模型（同一个提供方里）。主机在一轮跑着时会拒绝，调用方等这一轮结束再发。 */
export const configure = (sessionId: string, model: string, settings: Record<string, string>, mode: RuntimeMode) =>
  dispatch({ type: "configure", commandId: id(), sessionId, model, modelSettings: settings, runtimeMode: mode });

/** 模型自带的默认设置（思考强度等），切模型时沿用还能用的旧值。 */
export function settingsFor(model: AgentModel, previous: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const setting of model.settings ?? []) {
    const kept = previous[setting.id];
    out[setting.id] = kept && setting.options?.some((o) => o.value === kept) ? kept : String(setting.value ?? "");
  }
  return out;
}
