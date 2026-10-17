/** 第一次打开：填主机地址和凭据。连不上时按原因说清楚。 */
import { useRef, useState } from "react";
import { HostError, inTauri, pair, type ConnectionInfo } from "../host/rpc";
import { appVersion, t, useTranslation } from "../i18n";
import { Icon } from "../ui/icons";
import { Spinner, haptic } from "../ui/kit";

export function PairScreen({ onPaired }: { onPaired: (connection: ConnectionInfo) => void }) {
  useTranslation();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HostError | null>(null);
  const card = useRef<HTMLDivElement>(null);

  const connect = () => {
    if (!url.trim() || !token.trim()) return;
    haptic();
    setBusy(true);
    setError(null);
    const address = /^https?:\/\//.test(url.trim()) ? url.trim() : `http://${url.trim()}`;
    pair(address, token)
      .then(onPaired)
      .catch((e: HostError) => {
        setError(e);
        haptic(20);
        card.current?.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }],
          { duration: 360, easing: "ease-out" },
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="scroll-y flex h-full flex-col px-6" style={{ paddingTop: "calc(var(--safe-top) + 56px)", paddingBottom: "calc(var(--safe-bottom) + 24px)" }}>
      <div className="rise-in">
        <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-raised text-content/70">
          <Icon name="server" size={28} />
        </div>
        <h1 className="text-[26px] font-semibold leading-tight">{t("pair.title")}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-content/50">{t("pair.hint")}</p>
      </div>

      <div ref={card} className="rise-in mt-8 space-y-4" style={{ "--i": 2 } as React.CSSProperties}>
        <label className="block">
          <span className="mb-1.5 block text-xs text-content/45">{t("pair.url")}</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="http://mini.tail1234.ts.net:3775"
            className="h-12 w-full rounded-xl border border-stroke bg-raised px-3.5 font-mono text-[14px] outline-none transition-colors placeholder:text-content/25 focus:border-content/25"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-content/45">{t("pair.token")}</span>
          {/* 凭据不明文显示：在地铁上旁边的人也看不到 */}
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("pair.tokenPlaceholder")}
            className="h-12 w-full rounded-xl border border-stroke bg-raised px-3.5 font-mono text-[14px] outline-none transition-colors placeholder:font-sans placeholder:text-content/25 focus:border-content/25"
          />
        </label>
        {error ? (
          <div className="fade-in flex items-start gap-2 rounded-xl bg-red/10 px-3 py-2.5 text-[13px] leading-relaxed text-red">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>
              {t(`pair.error.${error.kind === "unpaired" ? "host" : error.kind}`)}
              {error.kind === "host" ? <span className="mt-1 block font-mono text-[11px] text-red/70">{error.message}</span> : null}
            </span>
          </div>
        ) : null}
        <button
          disabled={busy || !url.trim() || !token.trim() || !inTauri}
          onClick={connect}
          className="press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-ink transition-opacity disabled:opacity-40"
        >
          {busy ? <Spinner size={16} /> : null}
          {busy ? t("pair.connecting") : t("pair.connect")}
        </button>
        {!inTauri ? <p className="text-center text-xs text-content/40">{t("pair.browserOnly")}</p> : null}
      </div>

      <div className="rise-in mt-auto pt-10 text-[12px] leading-relaxed text-content/35" style={{ "--i": 4 } as React.CSSProperties}>
        <div className="mb-1 text-content/50">{t("pair.howTitle")}</div>
        <div>{t("pair.how1")}</div>
        <code className="my-1 block rounded-lg bg-raised px-2.5 py-1.5 font-mono text-[11.5px] text-content/60">node soloyard/host/gateway.ts pair --name Android</code>
        <div>{t("pair.how2")}</div>
        <div className="mt-4 text-content/25">{appVersion()}</div>
      </div>
    </div>
  );
}
