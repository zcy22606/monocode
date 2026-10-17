import { useEffect, useState } from "react";
import { AppContext } from "./app-context";
import { clearCache } from "./host/poll";
import { currentConnection, forget, isOnline, onAuthLost, onOnlineChange, type ConnectionInfo } from "./host/rpc";
import { t, useTranslation } from "./i18n";
import { FileScreen } from "./screens/File";
import { HomeScreen } from "./screens/Home";
import { MirrorScreen } from "./screens/Mirror";
import { PairScreen } from "./screens/Pair";
import { SessionScreen } from "./screens/Session";
import { WebScreen } from "./screens/Web";
import { IssueScreen } from "./screens/Issues";
import { Icon } from "./ui/icons";
import { Toaster } from "./ui/kit";
import { Navigator } from "./ui/nav";

export function App() {
  useTranslation();
  const [connection, setConnection] = useState<ConnectionInfo | null | undefined>(undefined);
  const [online, setOnline] = useState(isOnline());
  useEffect(() => onOnlineChange(setOnline), []);
  const [authLost, setAuthLost] = useState(false);
  useEffect(() => onAuthLost(() => setAuthLost(true)), []);
  useEffect(() => {
    currentConnection().then(setConnection, () => setConnection(null));
  }, []);

  // 断开后整页重来：页面栈、返回记录、缓存都清干净
  const disconnect = () =>
    void forget().then(() => {
      clearCache();
      location.reload();
    });

  if (connection === undefined) return <div className="h-full bg-background-base" />;
  if (!connection) return <PairScreen onPaired={setConnection} />;
  return (
    <AppContext.Provider value={{ connection, disconnect, online }}>
      <div className="fade-in h-full">
        <Navigator
          render={(route) =>
            route.name === "home" ? (
              <HomeScreen />
            ) : route.name === "mirror" ? (
              <MirrorScreen route={route} />
            ) : route.name === "file" ? (
              <FileScreen route={route} />
            ) : route.name === "web" ? (
              <WebScreen route={route} />
            ) : route.name === "issue" ? (
              <IssueScreen route={route} />
            ) : (
              <SessionScreen route={route} />
            )
          }
        />
      </div>
      <div
        className="pointer-events-none fixed inset-x-0 z-30 flex justify-center transition-all duration-300"
        style={{ top: "calc(var(--safe-top) + 64px)", opacity: online ? 0 : 1, transform: online ? "translateY(-8px)" : "none" }}
      >
        <div className="flex items-center gap-2 rounded-full border border-stroke bg-raised px-3.5 py-1.5 text-[12px] text-content/70 shadow-lg">
          <Icon name="offline" size={14} className="text-red" /> {t("app.offline")}
        </div>
      </div>
      <Toaster />
      {authLost ? (
        <div className="fade-in fixed inset-0 z-50 grid place-items-center bg-black/60 px-8">
          <div className="rise-in w-full rounded-2xl border border-stroke bg-raised p-5">
            <div className="mb-3 grid size-11 place-items-center rounded-xl bg-red/12 text-red">
              <Icon name="alert" size={22} />
            </div>
            <div className="text-[17px] font-semibold">{t("app.authLost.title")}</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-content/55">{t("app.authLost.hint")}</p>
            <button className="press mt-5 h-11 w-full rounded-xl bg-accent text-[15px] font-semibold text-accent-ink" onClick={disconnect}>
              {t("app.authLost.repair")}
            </button>
          </div>
        </div>
      ) : null}
    </AppContext.Provider>
  );
}
