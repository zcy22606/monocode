import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "../../../i18n";
import { CircleAlert, LoaderCircle, Play, Plus, RotateCcw, Square, X } from "../../../shared/ui/icons";
import { openProjectView } from "../model/projectViews";
import { AddServiceDialog } from "./AddServiceDialog";
import { relativeDir, restartService, serviceKey, shortCommand, startService, stopService, uptime, useServices, type Service } from "./api";
import { entryKey, removeHistory, sortHistory, useServiceHistory, type HistoryEntry } from "./history";

/** 在右边开某个服务的日志标签（按「目录 + 命令」认，停了也能开）。 */
export function openServiceLog(project: string, entry: { cwd: string; command: string }) {
  openProjectView({ cwd: project, view: "service", itemId: entryKey(entry), title: shortCommand(entry.command) });
}

/** 侧栏「服务」分页：上面是在跑的，下面是跑过 / 手动加的历史，点一行在右边开日志标签。 */
export function ServicesNav({ cwd }: { cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { services, error } = useServices(cwd);
  const history = useServiceHistory(cwd);
  const [adding, setAdding] = useState(false);
  if (!cwd || cwd === "~") return <p className="px-3 py-2 text-[12px] text-content/50">{t("nav.noFolder")}</p>;
  const running = new Set(services?.map(serviceKey));
  const stopped = sortHistory(history.filter((entry) => !running.has(entryKey(entry))));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-stroke px-3">
        <span className="flex-1 text-[12px] text-content/50">{t("services.title")}</span>
        <button
          type="button"
          title={t("services.add")}
          aria-label={t("services.add")}
          onClick={() => setAdding(true)}
          className="flex size-6 items-center justify-center rounded text-content/50 hover:bg-content/10 hover:text-content"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2">
        {error ? <p className="px-1 py-1 text-[12px] text-red-400">{error}</p> : null}
        {services?.length ? <SectionTitle>{t("services.running")}</SectionTitle> : null}
        {services?.map((service) => <ServiceRow key={service.pid} project={cwd} service={service} />)}
        {stopped.length ? <SectionTitle>{t("services.history")}</SectionTitle> : null}
        {stopped.map((entry) => (
          <HistoryRow key={entryKey(entry)} project={cwd} entry={entry} />
        ))}
        {services && !services.length && !stopped.length ? (
          <p className="px-1 py-1 text-[12px] text-content/50">{t("services.empty")}</p>
        ) : null}
      </div>
      {adding ? <AddServiceDialog project={cwd} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-content/40 first:pt-0">
      {children}
    </div>
  );
}

const ROW =
  "group flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-[13px] text-content/70 hover:bg-content/10 hover:text-content";

function ServiceRow({ project, service }: { project: string; service: Service }) {
  const { t } = useTranslation("soloyard");
  const age = uptime(service.startedAt, Date.now());
  const open = () => openServiceLog(project, service);
  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={(event) => event.key === "Enter" && open()} className={ROW}>
      <div className="flex h-6 items-center gap-1">
        {service.ports.map((port) => (
          <button
            key={port}
            type="button"
            title={t("services.openInBrowser", { port })}
            onClick={(event) => {
              event.stopPropagation();
              void openUrl(`http://localhost:${port}`).catch(() => undefined);
            }}
            className="rounded px-1 font-mono text-[12px] text-accent hover:bg-content/10 hover:underline"
          >
            :{port}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-[11px] text-content/40">{t(`services.uptime.${age.unit}`, { count: age.count })}</span>
        <ServiceActions project={project} service={service} />
      </div>
      <div className="truncate px-1 font-mono text-[12px]" title={service.command}>
        {shortCommand(service.command)}
      </div>
      <ServiceLocation service={service} className="px-1" />
    </div>
  );
}

function HistoryRow({ project, entry }: { project: string; entry: HistoryEntry }) {
  const { t } = useTranslation("soloyard");
  const open = () => openServiceLog(project, entry);
  const ago = entry.lastRunAt ? uptime(entry.lastRunAt, Date.now()) : undefined;
  const sub = relativeDir(entry.cwd, project);
  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={(event) => event.key === "Enter" && open()} className={ROW}>
      <div className="flex h-6 items-center gap-1">
        <span className="min-w-0 flex-1 truncate px-1 font-mono text-[12px]" title={entry.command}>
          {shortCommand(entry.command)}
        </span>
        <span className="shrink-0 text-[11px] text-content/40">
          {ago ? t(`services.ago.${ago.unit}`, { count: ago.count }) : t("services.neverRun")}
        </span>
        <StartButton project={project} entry={entry} />
        <IconButton label={t("services.remove")} onClick={() => removeHistory(project, entryKey(entry))}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      {sub ? (
        <div className="truncate px-1 text-[11px] text-content/40" title={entry.cwd}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** 分支 + 相对工作区根的子目录；开发版自己额外标出来。 */
export function ServiceLocation({ service, className = "" }: { service: Service; className?: string }) {
  const { t } = useTranslation("soloyard");
  const sub = relativeDir(service.cwd, service.root);
  const parts = [service.branch, sub].filter(Boolean);
  if (!parts.length && !service.isSelf) return null;
  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-[11px] text-content/40 ${className}`}>
      {service.isSelf ? (
        <span className="shrink-0 rounded bg-content/10 px-1 text-content/60" title={t("services.selfHint")}>
          {t("services.self")}
        </span>
      ) : null}
      <span className="truncate" title={service.cwd}>
        {parts.join(" · ")}
      </span>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  title,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded text-content/50 hover:bg-content/10 hover:text-content disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** 跑一个异步操作：转圈、出错在旁边显示红色感叹号。 */
function useAction() {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const run = (kind: string, action: () => Promise<unknown>) => {
    setPending(kind);
    setError(undefined);
    action()
      .catch((raw) => setError(String(raw)))
      .finally(() => setPending(undefined));
  };
  const errorIcon = error ? (
    <span title={error} className="mx-1 text-red-400">
      <CircleAlert className="size-3.5" aria-label={error} />
    </span>
  ) : null;
  return { pending, run, errorIcon };
}

const spinner = <LoaderCircle className="size-3.5 animate-spin" />;

/** 停止 / 重启。开发版自己禁用（Rust 端也会拒绝）。 */
export function ServiceActions({ project, service }: { project: string; service: Service }) {
  const { t } = useTranslation("soloyard");
  const { pending, run, errorIcon } = useAction();
  const hint = service.isSelf ? t("services.selfHint") : undefined;
  return (
    <span className="flex items-center">
      {errorIcon}
      <IconButton
        label={t("services.stop")}
        title={hint}
        disabled={service.isSelf || !!pending}
        onClick={() => run("stop", () => stopService(service.pid))}
      >
        {pending === "stop" ? spinner : <Square className="size-3.5" />}
      </IconButton>
      <IconButton
        label={t("services.restart")}
        title={hint}
        disabled={service.isSelf || !!pending}
        onClick={() => run("restart", () => restartService(project, service))}
      >
        {pending === "restart" ? spinner : <RotateCcw className="size-3.5" />}
      </IconButton>
    </span>
  );
}

/** 启动历史里的服务，并打开它的日志标签（起不来也能马上看到报错）。 */
export function StartButton({ project, entry }: { project: string; entry: { cwd: string; command: string } }) {
  const { t } = useTranslation("soloyard");
  const { pending, run, errorIcon } = useAction();
  return (
    <>
      {errorIcon}
      <IconButton
        label={t("services.start")}
        disabled={!!pending}
        onClick={() =>
          run("start", async () => {
            await startService(project, entry.cwd, entry.command);
            openServiceLog(project, entry);
          })
        }
      >
        {pending ? spinner : <Play className="size-3.5" />}
      </IconButton>
    </>
  );
}
