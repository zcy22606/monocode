/**
 * 电脑 / 主机上跑着的本地服务（开发服务器，SOL-97），在 app 里打开：上面一条地址栏（显示成 localhost:端口，路径能改）、
 * 刷新、用浏览器打开。页面是另一个来源（那台机器的 Tailscale 地址），碰不到 app；热更新的 WebSocket 经同一个转发照样通。
 * 点了先进这一页、转着圈，再请那台机器开转发、等页面加载完（走中继时要一两秒）。
 */
import { useEffect, useState } from "react";
import { android, fileError } from "../host/files";
import { openLocalService } from "../host/host";
import { t, useTranslation } from "../i18n";
import { Icon } from "../ui/icons";
import { Spinner, haptic, toast } from "../ui/kit";
import { useNav, type Route } from "../ui/nav";
import { FileProblem } from "./File";

export function WebScreen({ route }: { route: Extract<Route, { name: "web" }> }) {
  useTranslation();
  const nav = useNav();
  const [origin, setOrigin] = useState<string>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [path, setPath] = useState(route.path);
  const [draft, setDraft] = useState(path);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    openLocalService(route.source, route.id, route.port).then(
      ({ url }) => live && setOrigin(url),
      (e) => live && setError(fileError(e)),
    );
    return () => {
      live = false;
    };
  }, [route.source, route.id, route.port, attempt]);
  const src = origin && `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  const reload = () => {
    setLoaded(false);
    setRound((n) => n + 1);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-stroke pb-1.5 pl-1 pr-2" style={{ paddingTop: "calc(var(--safe-top) + 6px)" }}>
        <button aria-label="back" className="press grid size-11 shrink-0 place-items-center rounded-full text-content/70 active:bg-selection" onClick={nav.back}>
          <Icon name="back" size={22} />
        </button>
        <form
          className="flex h-9 min-w-0 flex-1 items-center rounded-lg bg-selection px-2.5 font-mono text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
            setPath(draft.trim() || "/");
            reload();
          }}
        >
          {/* 那台机器上的地址：手机连的是转发出来的 Tailscale 地址，给人看还是 localhost */}
          <span className="shrink-0 text-content/45">localhost:{route.port}</span>
          <input
            aria-label={t("web.address")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-content outline-none"
          />
        </form>
        <button
          aria-label={t("web.refresh")}
          className="press grid size-11 shrink-0 place-items-center rounded-full text-content/60 active:bg-selection"
          onClick={() => {
            haptic();
            if (error) setAttempt((n) => n + 1);
            else reload();
          }}
        >
          <Icon name="refresh" size={19} />
        </button>
        <button
          aria-label={t("web.openInBrowser")}
          className="press grid size-11 shrink-0 place-items-center rounded-full text-content/60 active:bg-selection"
          disabled={!src}
          onClick={() => {
            haptic();
            if (src) android("browse", src).catch((e: Error) => toast(e.message));
          }}
        >
          <Icon name="openWith" size={19} />
        </button>
      </header>
      <div className="relative min-h-0 flex-1">
        {src ? (
          <iframe key={`${src}:${round}`} title={`localhost:${route.port}`} src={src} allow="clipboard-write; fullscreen" onLoad={() => setLoaded(true)} className="h-full w-full border-0 bg-white" />
        ) : null}
        {error ? (
          <div className="absolute inset-0 bg-background-base">
            <FileProblem message={error} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        ) : !loaded ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background-base text-[13px] text-content/45">
            <Spinner size={20} />
            {t(route.source === "host" ? "web.loadingHost" : "web.loading")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
