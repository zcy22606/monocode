/**
 * Soloyard 请底座做的事（开会话、切到会话、给会话发消息）。用窗口事件传给 App，
 * 不用把回调一层层传进标签内容；App 里只有一个监听（见 App.tsx 里的 Soloyard 注释）。
 */

export type StartWorkRequest = {
  cwd: string;
  /** 事先生成，先挂到 issue 上再开会话。 */
  sessionId: string;
  prompt: string;
};

/** 先打开会话（没开就打开），再把消息发进去。 */
export type SendToSessionRequest = { sessionId: string; text: string };

/** 带回执的请求：App 处理完调 reply，出错时带原因（比如会话正在运行）。 */
type WithReply<T> = T & { reply: (error?: string) => void };
export type MoveSessionRequest = { sessionId: string; cwd: string };

type Actions = {
  "soloyard:start-work": StartWorkRequest;
  "soloyard:open-session": { sessionId: string };
  "soloyard:send-to-session": SendToSessionRequest;
  "soloyard:move-session": WithReply<MoveSessionRequest>;
  "soloyard:delete-session": WithReply<{ sessionId: string }>;
};

function emit<K extends keyof Actions>(name: K, detail: Actions[K]) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function on<K extends keyof Actions>(name: K, handler: (detail: Actions[K]) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<Actions[K]>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

/** 开一个新会话，开工提示词预先填进输入框；模型、工作区由用户在输入框里选，确认后自己发送。 */
export const requestStartWork = (request: StartWorkRequest) => emit("soloyard:start-work", request);
export const requestOpenSession = (sessionId: string) => emit("soloyard:open-session", { sessionId });
export const requestSendToSession = (request: SendToSessionRequest) => emit("soloyard:send-to-session", request);

function withReply<K extends "soloyard:move-session" | "soloyard:delete-session">(name: K, detail: Omit<Actions[K], "reply">) {
  return new Promise<void>((resolve, reject) =>
    emit(name, { ...detail, reply: (error?: string) => (error ? reject(new Error(error)) : resolve()) } as Actions[K]),
  );
}
/**
 * 把会话挪到另一个工作目录，原会话接着聊（头脑风暴改文件夹名、提升为项目）。
 * Claude Code / Codex 都按会话 id 续聊，不用搬转录文件；正在运行的会话会被拒绝。
 */
export const requestMoveSession = (request: MoveSessionRequest) => withReply("soloyard:move-session", request);
/** 删除会话（调用方已经确认过）。 */
export const requestDeleteSession = (sessionId: string) => withReply("soloyard:delete-session", { sessionId });

export type SoloyardAppHandlers = {
  startWork: (request: StartWorkRequest) => void;
  openSession: (sessionId: string) => void;
  sendToSession: (request: SendToSessionRequest) => void;
  /** 返回出错原因，成功返回 undefined。 */
  moveSession: (request: MoveSessionRequest) => string | undefined;
  deleteSession: (sessionId: string) => Promise<boolean>;
};

export function onSoloyardAppActions(handlers: SoloyardAppHandlers): () => void {
  const offs = [
    on("soloyard:start-work", handlers.startWork),
    on("soloyard:open-session", ({ sessionId }) => handlers.openSession(sessionId)),
    on("soloyard:send-to-session", handlers.sendToSession),
    on("soloyard:move-session", ({ reply, ...request }) => reply(handlers.moveSession(request))),
    on("soloyard:delete-session", ({ reply, sessionId }) =>
      void handlers.deleteSession(sessionId).then(
        (ok) => reply(ok ? undefined : "cancelled"),
        (e: unknown) => reply(String(e)),
      ),
    ),
  ];
  return () => offs.forEach((off) => off());
}
