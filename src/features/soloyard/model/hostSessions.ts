/**
 * Soloyard：服务器上的会话（手机上开在服务器上的）拿回这台电脑接着聊（SOL-89）。
 * 网关那边见 soloyard/host/gateway.ts 的 hostSessions / takeFromHost。
 */
import type { Session } from "../../sessions/model/session";

/** 服务器上的一个会话（列表用）。 */
export type HostSessionRow = {
  id: string;
  title: string;
  harness: string;
  model: string;
  status: string;
  needsInput: boolean;
  updatedAt: number;
};

/** 拿回来的会话里电脑要用的部分。 */
export type HostTurns = Pick<Session, "harness" | "model" | "modelSettings" | "runtimeMode" | "title" | "blocks"> & {
  providerSessionId: string;
};
export type TakenSession = { session: HostTurns };

/** 新开一个本地会话装它。 */
export function seedFromHost(host: HostTurns): Partial<Session> {
  const { harness, model, modelSettings, runtimeMode, title, blocks, providerSessionId } = host;
  return { harness, model, modelSettings, runtimeMode, title, blocks, providerSessionId };
}
