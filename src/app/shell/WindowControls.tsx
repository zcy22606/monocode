import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "../../shared/ui/icons";
import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n";

export function WindowControls() {
  const { t } = useTranslation("shell");
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    const win = getCurrentWindow();
    void win.isMaximized().then((max) => {
      if (mounted) setIsMaximized(max);
    }).catch(() => {});

    void win.onResized(async () => {
      try {
        const max = await win.isMaximized();
        if (mounted) setIsMaximized(max);
      } catch {}
    }).then((unlistenFn) => {
      if (mounted) {
        unlisten = unlistenFn;
      } else {
        unlistenFn();
      }
    }).catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const handleMinimize = () => {
    try {
      void getCurrentWindow().minimize();
    } catch {}
  };

  const handleToggleMaximize = () => {
    try {
      void getCurrentWindow().toggleMaximize();
    } catch {}
  };

  const handleClose = () => {
    try {
      void getCurrentWindow().close();
    } catch {}
  };

  return (
    <div
      className="flex h-full shrink-0 items-stretch border-l border-stroke"
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        title={t("window.minimize")}
        aria-label={t("window.minimizeWindow")}
        data-tauri-drag-region="false"
        onClick={handleMinimize}
        className="flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-content/10 hover:text-content"
      >
        <Minus className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title={isMaximized ? t("window.restore") : t("window.maximize")}
        aria-label={
          isMaximized ? t("window.restoreWindow") : t("window.maximizeWindow")
        }
        data-tauri-drag-region="false"
        onClick={handleToggleMaximize}
        className="flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-content/10 hover:text-content"
      >
        {isMaximized ? (
          <Copy className="size-3" strokeWidth={1.75} />
        ) : (
          <Square className="size-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        title={t("window.close")}
        aria-label={t("window.closeWindow")}
        data-tauri-drag-region="false"
        onClick={handleClose}
        className="flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-red-600 hover:text-white"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
