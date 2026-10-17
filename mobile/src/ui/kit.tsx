/** 小部件：底部面板、提示条、状态点、加载圈、触感。 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { goBack, pushBack } from "./back";
import { Icon } from "./icons";

/** 轻触感（安卓上要 VIBRATE 权限，没有就什么也不做）。 */
export const haptic = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // 不支持就算了
  }
};

const SHEET_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * 底部面板的开关。`open(值)` 打开并占一条返回记录，`close()` 走返回栈关掉，
 * 安卓返回键也会关它。
 */
export function useSheet<T>() {
  const [value, setValue] = useState<T | null>(null);
  return {
    value,
    open: (next: T) => {
      setValue(next);
      pushBack(() => setValue(null));
    },
    close: () => goBack(),
  };
}

/**
 * 从底部滑上来的面板：遮罩淡入、面板按减速曲线上滑；拖住顶部把手往下拉，
 * 拉过四分之一或甩得够快就关，不然弹回去。
 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useLayoutEffect(() => {
    const p = panel.current;
    const s = scrim.current;
    if (!p || !s) return;
    // 从当前位置接着动（可能正被拖着，或者上一个动画还没播完）
    const y = new DOMMatrixReadOnly(getComputedStyle(p).transform).m42;
    const opacity = getComputedStyle(s).opacity;
    for (const a of [...p.getAnimations(), ...s.getAnimations()]) a.cancel();
    p.style.transform = "";
    s.style.opacity = "";
    if (open) {
      p.animate([{ transform: y ? `translateY(${y}px)` : "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 420, easing: SHEET_EASE });
      s.animate([{ opacity: y ? opacity : 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    } else {
      const a = p.animate([{ transform: `translateY(${Math.max(0, y)}px)` }, { transform: "translateY(100%)" }], {
        duration: 260,
        easing: "cubic-bezier(0.4, 0, 1, 1)",
        fill: "forwards",
      });
      s.animate([{ opacity }, { opacity: 0 }], { duration: 240, fill: "forwards" });
      // 被取消（又打开了）时不卸载
      a.finished.then(() => setMounted(false), () => {});
    }
  }, [open, mounted]);

  if (!mounted) return null;

  const start = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !panel.current || !scrim.current) return;
    const raw = e.clientY - d.y;
    // 往上拉给一点阻尼，往下跟手
    d.dy = raw < 0 ? raw / 6 : raw;
    panel.current.style.transform = `translateY(${d.dy}px)`;
    scrim.current.style.opacity = String(Math.max(0, 1 - Math.max(0, d.dy) / panel.current.offsetHeight));
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    const p = panel.current;
    const s = scrim.current;
    if (!d || !p || !s) return;
    const velocity = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > p.offsetHeight * 0.25 || velocity > 0.6) {
      haptic(6);
      onClose();
      return;
    }
    p.animate([{ transform: `translateY(${d.dy}px)` }, { transform: "translateY(0)" }], { duration: 300, easing: SHEET_EASE });
    s.animate([{ opacity: s.style.opacity || 1 }, { opacity: 1 }], { duration: 200 });
    p.style.transform = "";
    s.style.opacity = "";
  };

  return createPortal(
    <div className="fixed inset-0 z-40">
      <div ref={scrim} className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        className="absolute inset-x-0 bottom-0 flex max-h-[88%] flex-col rounded-t-[22px] border-t border-stroke bg-raised shadow-[0_-12px_40px_rgba(0,0,0,0.45)]"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        <div className="shrink-0 touch-none select-none pb-1 pt-2.5" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          <div className="mx-auto h-1 w-9 rounded-full bg-content/25" />
          {title ? <div className="px-5 pb-1 pt-3 text-[17px] font-semibold">{title}</div> : null}
        </div>
        <div className="scroll-y min-h-0 flex-1 px-3 pb-3">{children}</div>
        {footer ? <div className="shrink-0 border-t border-stroke px-4 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ---------- 提示条 ----------
type ToastItem = { id: number; text: string; leaving?: boolean };
let pushToast: (text: string) => void = () => {};
export const toast = (text: string) => pushToast(text);

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (text) => {
      const id = ++n;
      setItems((list) => [...list.slice(-1), { id, text }]);
      window.setTimeout(() => setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 2000);
      window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 2300);
    };
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2" style={{ top: "calc(var(--safe-top) + 68px)" }}>
      {items.map((t) => (
        <div
          key={t.id}
          className="rounded-full bg-content px-4 py-2 text-[13px] font-medium text-background-base shadow-lg transition-all duration-300"
          style={{ animation: "drop-in 320ms var(--ease-out-quint) both", opacity: t.leaving ? 0 : 1, transform: t.leaving ? "translateY(-6px) scale(0.98)" : undefined }}
        >
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------- 小东西 ----------
export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg className="spin" viewBox="0 0 24 24" width={size} height={size} fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export type Tone = "input" | "running" | "fresh" | "idle" | "error";
const DOT: Record<Tone, string> = {
  input: "bg-amber",
  running: "bg-accent pulse",
  fresh: "bg-green",
  idle: "bg-content/25",
  error: "bg-red",
};
export const Dot = ({ tone, className = "" }: { tone: Tone; className?: string }) => (
  <span className={`inline-block size-2 shrink-0 rounded-full ${DOT[tone]} ${className}`} />
);

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px] bg-raised-2 font-semibold text-content/70"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Empty({ icon, title, hint, action }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center px-10 pb-10 pt-16 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-raised text-content/40">
        <Icon name={icon} size={26} />
      </div>
      <div className="text-[15px] font-medium text-content/85">{title}</div>
      {hint ? <div className="mt-1.5 text-[13px] leading-relaxed text-content/45">{hint}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
