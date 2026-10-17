/**
 * Soloyard：手机发给这台电脑上会话的消息（经家里主机的网关，SOL-89）。每 2 秒取一次，
 * 取到就发进那个会话，和在电脑上打字发出去一样：电脑自己跑，「进行中」、「已完成」、用时都照常。
 * 每次来取也是告诉网关电脑开着；关了 Soloyard，手机就改在主机上接着聊。
 */
import { useEffect, useRef } from "react";
import { stopHarnessBackgroundJob } from "../../../integrations/harness/core/registry";
import type { Session } from "../../sessions/model/session";
import { mutateSoloyard, soloyardCall } from "../data/api";
import { requestSendToSession, requestStartWork } from "./appActions";

/** 手机上从 issue 开工（SOL-100）：新会话里直接把提示词发出去，带仓库的在那个仓库的新工作树里开，再挂到 issue 上。 */
type StartWork = {
  kind: "startWork";
  cwd: string;
  prompt: string;
  issueId: number;
  workCwd?: string;
  model?: { harness: Session["harness"]; model: string; settings: Session["modelSettings"] };
};
/** stopJob = 不是消息，是在手机上停掉这个会话的某个后台任务（SOL-99）；action = 交给界面做的事。 */
type Relayed = { id: string; sessionId: string; text: string; stopJob?: string; action?: StartWork };

function startWork(a: StartWork) {
  const sessionId = requestStartWork({
    cwd: a.cwd,
    sessionId: crypto.randomUUID(),
    prompt: a.prompt,
    workCwd: a.workCwd,
    newWorktree: !!a.workCwd,
    send: true,
    seed: a.model ? { harness: a.model.harness, model: a.model.model, modelSettings: a.model.settings } : undefined,
  });
  void mutateSoloyard("linkSession", sessionId, "issue", String(a.issueId)).catch(() => undefined);
}
const EVERY = 2000;

export function useRelayInbox(sessions: readonly Session[]) {
  const latest = useRef(sessions);
  latest.current = sessions;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      const messages = await soloyardCall<Relayed[]>("relayInbox").catch(() => []);
      for (const m of messages) {
        if (m.action?.kind === "startWork") {
          startWork(m.action);
          continue;
        }
        if (!m.stopJob) {
          requestSendToSession({ sessionId: m.sessionId, text: m.text });
          continue;
        }
        const session = latest.current.find((s) => s.id === m.sessionId);
        if (session) void stopHarnessBackgroundJob(session.harness, session.id, m.stopJob).catch(() => undefined);
      }
      if (!stopped) timer = setTimeout(tick, EVERY);
    };
    timer = setTimeout(tick, EVERY);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
}
