import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useTranslation } from "../../../i18n";
import { isLightScheme, SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";
import { fitTerminal } from "../../terminal/model/terminalLayout";
import { terminalFont, terminalTheme } from "../../terminal/ui/TerminalView";
import { readServiceLog, serviceKey, useServices } from "./api";
import { entryKey, parseEntryKey, useServiceHistory } from "./history";
import { ServiceActions, ServiceLocation, StartButton } from "./ServicesNav";

const POLL_MS = 1000;

/**
 * 某个服务的日志标签：只读的终端，每秒追加 stdout 文件的新内容。
 * itemId 是「目录 + 命令」（见 history.ts）；服务停了显示上次的日志和启动按钮。
 */
export function ServiceLog({ cwd, itemId }: { cwd: string; itemId: string }) {
  const { t } = useTranslation("soloyard");
  const { services } = useServices(cwd);
  const history = useServiceHistory(cwd);
  const target = parseEntryKey(itemId);
  const service = services?.find((entry) => serviceKey(entry) === itemId);
  const logPath = service?.logPath ?? history.find((entry) => entryKey(entry) === itemId)?.logPath ?? null;
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      disableStdin: true,
      convertEol: true,
      cursorInactiveStyle: "none",
      fontFamily: terminalFont(),
      fontSize: 12,
      scrollback: 10000,
      allowTransparency: true,
      theme: terminalTheme(isLightScheme()),
    });
    term.open(host);
    termRef.current = term;
    const fit = () => fitTerminal(term, host, "shell");
    const observer = new ResizeObserver(() => requestAnimationFrame(fit));
    observer.observe(host);
    const onScheme = () => (term.options.theme = terminalTheme(isLightScheme()));
    window.addEventListener(SCHEME_CHANGE_EVENT, onScheme);
    return () => {
      observer.disconnect();
      window.removeEventListener(SCHEME_CHANGE_EVENT, onScheme);
      termRef.current = null;
      term.dispose();
    };
  }, []);

  // 换了日志文件（重启后）就清屏从头读；服务停了保留已有内容。
  useEffect(() => {
    const term = termRef.current;
    if (!term || !logPath) return;
    term.reset();
    let offset = 0;
    let busy = false;
    const pull = () => {
      if (busy || document.hidden) return;
      busy = true;
      readServiceLog(logPath, offset)
        .then((chunk) => {
          if (chunk.offset < offset) term.reset();
          offset = chunk.offset;
          if (chunk.data) term.write(chunk.data);
        })
        .catch(() => undefined)
        .finally(() => (busy = false));
    };
    pull();
    const timer = window.setInterval(pull, POLL_MS);
    return () => window.clearInterval(timer);
  }, [logPath]);

  const notice = !services
    ? null
    : !service
      ? t("services.log.notRunning")
      : !logPath
        ? t("services.log.noLog")
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {service ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-stroke px-3 py-1.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="truncate font-mono text-[12px] text-content/80" title={service.command}>
              {service.ports.map((p) => `:${p}`).join(" ")} · {service.command}
            </div>
            <ServiceLocation service={service} />
          </div>
          <ServiceActions project={cwd} service={service} />
        </header>
      ) : target ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-stroke px-3 py-1.5">
          <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-content/60" title={target.cwd}>
            {target.command}
          </div>
          <StartButton project={cwd} entry={target} />
        </header>
      ) : null}
      {notice ? <p className="shrink-0 px-3 py-2 text-[12px] text-content/50">{notice}</p> : null}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-2 py-1" />
    </div>
  );
}
