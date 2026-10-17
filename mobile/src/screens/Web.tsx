/**
 * 电脑 / 主机上跑着的本地服务（开发服务器，SOL-97），在 app 里打开：上面一条地址栏（显示成 localhost:端口，路径能改）、
 * 刷新、用浏览器打开。页面是另一个来源（那台机器的 Tailscale 地址），碰不到 app；热更新的 WebSocket 经同一个转发照样通。
 */
import { useState } from "react";
import { android } from "../host/files";
import { t, useTranslation } from "../i18n";
import { Icon } from "../ui/icons";
import { haptic, toast } from "../ui/kit";
import { useNav, type Route } from "../ui/nav";

export function WebScreen({ route }: { route: Extract<Route, { name: "web" }> }) {
  useTranslation();
  const nav = useNav();
  const base = new URL(route.url);
  const [path, setPath] = useState(base.pathname + base.search + base.hash);
  const [draft, setDraft] = useState(path);
  const [round, setRound] = useState(0);
  const src = `${base.origin}${path.startsWith("/") ? path : `/${path}`}`;

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
            setRound((n) => n + 1);
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
            setRound((n) => n + 1);
          }}
        >
          <Icon name="refresh" size={19} />
        </button>
        <button
          aria-label={t("web.openInBrowser")}
          className="press grid size-11 shrink-0 place-items-center rounded-full text-content/60 active:bg-selection"
          onClick={() => {
            haptic();
            android("browse", src).catch((e: Error) => toast(e.message));
          }}
        >
          <Icon name="openWith" size={19} />
        </button>
      </header>
      <iframe key={`${src}:${round}`} title={`localhost:${route.port}`} src={src} allow="clipboard-write; fullscreen" className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
