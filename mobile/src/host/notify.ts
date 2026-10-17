/**
 * 手机通知（SOL-104）：会话跑完了、等你处理时弹系统通知，点了进那个会话。
 * 常驻服务在原生层（NotifyService.kt）长连网关；这里只管开关、状态，和点通知以后打开哪一页。
 */
import { useEffect, useState } from "react";
import { androidCall } from "./files";

/** lastOk = 常驻服务上次连上网关的时间（毫秒），lastError = 之后连不上的原因；stoppedAt / stoppedFor = 最近一次被系统停住（锁屏后冻结）的开始时间和时长。 */
export type NotifyStatus = { enabled: boolean; allowed: boolean; background: boolean; lastOk: number; lastError: string; stoppedAt: number; stoppedFor: number };
/** 网关发来的一条（gateway.ts 的 waitEvents）。 */
export type NotifyEvent = {
  id: number;
  kind: "done" | "input";
  source: "mirror" | "host";
  sessionId: string;
  title: string;
  machine?: string;
  cwd?: string;
  projectId?: string;
};

const parse = (data: string) => JSON.parse(data) as NotifyStatus;
export const notifyStatus = () => androidCall({ action: "notifyStatus" }).then(parse);
export const setNotify = (on: boolean) => androidCall({ action: on ? "notifyOn" : "notifyOff" }).then(parse);
/** 省电设置（锁屏后也能连着）；已经放开了就打开应用设置，ColorOS 的「自启动」在那里。 */
export const openBackgroundSettings = () => androidCall({ action: "notifyBackground" });
export const openAppSettings = () => androidCall({ action: "appSettings" });

/** 常驻服务每次等网关最多 25 秒，这么久内连上过就算连着。 */
export const notifyConnected = (status: NotifyStatus) => Date.now() - status.lastOk < 70_000;

/** 最近一天里被系统停住过：锁屏后这段时间的通知收不到。 */
export const notifyStopped = (status: NotifyStatus) => status.stoppedAt > Date.now() - 86_400_000;

/** 状态：打开时读，开着时每 5 秒再读（连没连上会变），回到 app 时也读（从系统设置回来可能变了）。不在安卓里是 null。 */
export function useNotifyStatus(active: boolean) {
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  useEffect(() => {
    if (!active) return;
    const read = () => void notifyStatus().then(setStatus, () => setStatus(null));
    read();
    const timer = setInterval(read, 5000);
    const onVisible = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
  return [status, setStatus] as const;
}

/** 点了通知：冷启动时问原生层要，app 开着时原生层直接发 soloyard:notification。 */
export function useNotificationOpen(open: (event: NotifyEvent) => void) {
  useEffect(() => {
    void androidCall({ action: "takeOpen" }).then(
      (data) => data && open(JSON.parse(data) as NotifyEvent),
      () => undefined,
    );
    const listener = (e: Event) => open((e as CustomEvent<NotifyEvent>).detail);
    window.addEventListener("soloyard:notification", listener);
    return () => window.removeEventListener("soloyard:notification", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** 正开着的会话：app 在前台时它的通知不弹（看得见），别的会话照弹。 */
export function useViewing(sessionId: string | undefined, active: boolean) {
  useEffect(() => {
    if (!active || !sessionId) return;
    void androidCall({ action: "viewing", session: sessionId }).catch(() => undefined);
    return () => void androidCall({ action: "viewing", session: "" }).catch(() => undefined);
  }, [sessionId, active]);
}
