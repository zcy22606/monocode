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

type Actions = {
  "soloyard:start-work": StartWorkRequest;
  "soloyard:open-session": { sessionId: string };
  "soloyard:send-to-session": SendToSessionRequest;
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

export type SoloyardAppHandlers = {
  startWork: (request: StartWorkRequest) => void;
  openSession: (sessionId: string) => void;
  sendToSession: (request: SendToSessionRequest) => void;
};

export function onSoloyardAppActions(handlers: SoloyardAppHandlers): () => void {
  const offs = [
    on("soloyard:start-work", handlers.startWork),
    on("soloyard:open-session", ({ sessionId }) => handlers.openSession(sessionId)),
    on("soloyard:send-to-session", handlers.sendToSession),
  ];
  return () => offs.forEach((off) => off());
}
