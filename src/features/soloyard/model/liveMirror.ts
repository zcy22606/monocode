/**
 * Soloyard：电脑上正在跑的这一轮实时推给手机（SOL-89）。底座只在一轮开始和结束时存盘，
 * 存盘的整份由数据进程每 5 秒推一次；中间过程从内存里拿，每个会话最多每秒推一次，跑完再推最后一次。
 * 没配手机同步时数据进程直接丢掉，不出网。
 */
import { useEffect, useRef } from "react";
import type { BackgroundJob, Block, Session } from "../../sessions/model/session";
import { soloyardCall } from "../data/api";

const EVERY = 1000;
/** 后台任务列表不空时隔这么久续一次（网关一分钟没续就当电脑没了）。 */
const JOBS_EVERY = 30_000;
// ponytail: 一轮超长时只推最后 120 块（和手机一页一样多），要看更早的等这一轮跑完存盘
const MAX_BLOCKS = 120;

type Live = { from?: string; blocks: Block[]; busy: boolean };
type Tracked = { sig: string; sentAt: number; pending?: Live; timer?: ReturnType<typeof setTimeout> };

/** 这一轮：从最后一条用户消息起；附件里的图片数据不带（大，手机也不显示）。 */
export function currentTurn(session: Pick<Session, "blocks" | "busy">): Live {
  const blocks = session.blocks;
  let start = blocks.length;
  while (start > 0 && !(blocks[start - 1].role === "user" && !blocks[start - 1].draft)) start--;
  const turn = (start > 0 ? blocks.slice(start - 1) : blocks).slice(-MAX_BLOCKS).map((block) =>
    block.attachments ? { ...block, attachments: block.attachments.map(({ data: _data, ...rest }) => rest) } : block,
  );
  return { from: turn[0]?.id, blocks: turn, busy: !!session.busy };
}

/** 有没有变：块数、文字长度、工具状态、流式标记。比整份 JSON 便宜得多。 */
export function turnSignature(live: Live) {
  let text = 0;
  let marks = "";
  for (const block of live.blocks) {
    text += block.text.length;
    marks += `${block.tool?.status ?? ""}${block.streaming ? "~" : ""}${block.durationMs ? "d" : ""},`;
  }
  return `${live.busy}|${live.blocks.length}|${live.blocks[live.blocks.length - 1]?.id}|${text}|${marks}`;
}

/** 后台任务列表有没有变：任务和它的名字、命令（命令常常晚一点才报上来）。 */
export const jobsSignature = (jobs?: readonly BackgroundJob[]) => (jobs ?? []).map((job) => `${job.id}:${job.title}:${job.command ?? ""}`).join("|");

export function useLiveMirror(sessions: readonly Session[]) {
  const tracked = useRef(new Map<string, Tracked>());
  // 还在后台跑的任务（SOL-99）：不管这一轮跑没跑完，变了就推，不空时每 30 秒续一次，空了推一次空的就不管了
  const jobsSent = useRef(new Map<string, string>());
  const latest = useRef(sessions);
  latest.current = sessions;
  useEffect(() => {
    const pushJobs = (session: Session) => {
      const jobs = (session.backgroundJobs ?? []).map(({ id, title, command, startedAt }) => ({ id, title, command, startedAt }));
      const sig = jobsSignature(jobs);
      if (sig) jobsSent.current.set(session.id, sig);
      else jobsSent.current.delete(session.id);
      void soloyardCall("jobsPush", session.id, jobs).catch(() => undefined);
    };
    for (const session of sessions) {
      const sig = jobsSignature(session.backgroundJobs);
      if ((jobsSent.current.get(session.id) ?? "") !== sig) pushJobs(session);
    }
    const timer = setInterval(() => {
      for (const id of jobsSent.current.keys()) {
        const session = latest.current.find((s) => s.id === id);
        if (session) pushJobs(session);
      }
    }, JOBS_EVERY);
    return () => clearInterval(timer);
  }, [sessions]);
  useEffect(() => {
    const send = (id: string, entry: Tracked, live: Live) => {
      entry.sentAt = Date.now();
      entry.pending = undefined;
      void soloyardCall("livePush", id, live).catch(() => undefined);
      if (!live.busy) tracked.current.delete(id);
    };
    for (const session of sessions) {
      const entry = tracked.current.get(session.id);
      // 只管在跑的，和刚跑完、还要推最后一次的
      if (!session.busy && !entry) continue;
      if (session.inboxAsk || session.sidebarHidden) continue;
      const live = currentTurn(session);
      const sig = turnSignature(live);
      if (entry?.sig === sig) continue;
      const next: Tracked = entry ?? { sig, sentAt: 0 };
      next.sig = sig;
      tracked.current.set(session.id, next);
      const wait = next.sentAt + EVERY - Date.now();
      if (wait <= 0 && !next.timer) send(session.id, next, live);
      else {
        // 这一秒里的变化攒着，到点推最新的那份
        next.pending = live;
        next.timer ??= setTimeout(() => {
          next.timer = undefined;
          if (next.pending) send(session.id, next, next.pending);
        }, Math.max(0, wait));
      }
    }
  }, [sessions]);
  useEffect(() => () => tracked.current.forEach((entry) => clearTimeout(entry.timer)), []);
}
