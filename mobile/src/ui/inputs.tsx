/** 输入框、发送 / 停止按钮、下拉刷新。 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp } from "../../../src/shared/ui/icons";
import { Icon } from "./icons";
import { Spinner } from "./kit";

/** 跟着内容长高的输入框，最多六行。 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea(props, ref) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current!);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 20 + 22)}px`;
  }, [props.value]);
  return (
    <textarea
      ref={inner}
      rows={1}
      {...props}
      className={`max-h-[142px] min-h-[44px] flex-1 resize-none rounded-[22px] border border-stroke bg-raised px-4 py-[11px] text-[15px] leading-5 outline-none transition-colors placeholder:text-content/35 focus:border-content/20 ${props.className ?? ""}`}
    />
  );
});

/** 发送和停止共用一个按钮（照电脑：圆角方块、强调色、ArrowUp01），切换时图标交叉淡入、轻微缩放。 */
export function ActionButton({ mode, disabled, busy, onClick }: { mode: "send" | "stop"; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  const stop = mode === "stop";
  return (
    <button
      aria-label={stop ? "stop" : "send"}
      disabled={disabled}
      onClick={onClick}
      className={`press relative grid size-11 shrink-0 place-items-center rounded-[12px] transition-[background-color,transform] duration-200 ${
        stop ? "bg-content text-background-base" : disabled ? "bg-content/10 text-content/30" : "bg-accent text-white"
      }`}
    >
      {busy ? (
        <Spinner size={18} />
      ) : (
        <>
          <span className={`absolute transition-all duration-200 ${stop ? "scale-50 opacity-0" : "scale-100 opacity-100"}`}>
            <ArrowUp className="size-5" strokeWidth={2.2} />
          </span>
          <span className={`absolute size-3.5 rounded-[3px] bg-current transition-all duration-200 ${stop ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
        </>
      )}
    </button>
  );
}

/**
 * 能下拉刷新的滚动区：在顶上往下拉，拉过门槛松手就刷新，转圈直到刷新完成。
 */
export const PullScroll = forwardRef<HTMLDivElement, { onRefresh: () => Promise<unknown>; children: ReactNode; className?: string }>(function PullScroll(
  { onRefresh, children, className = "" },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scroller.current!);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const THRESHOLD = 64;

  return (
    <div className={`relative min-h-0 flex-1 ${className}`}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{
          transform: `translateY(${refreshing ? 14 : Math.min(pull, THRESHOLD + 20) - 28}px)`,
          opacity: refreshing ? 1 : Math.min(1, pull / THRESHOLD),
          transition: start.current === null ? "transform 300ms var(--ease-out-quint), opacity 200ms" : undefined,
        }}
      >
        <div className="grid size-8 place-items-center rounded-full border border-stroke bg-raised text-content/70 shadow-md">
          {refreshing ? (
            <Spinner size={16} />
          ) : (
            <span style={{ transform: `rotate(${(pull / THRESHOLD) * 270}deg)` }}>
              <Icon name="refresh" size={16} />
            </span>
          )}
        </div>
      </div>
      <div
        ref={scroller}
        className="scroll-y h-full"
        style={{
          transform: `translateY(${refreshing ? 48 : pull * 0.6}px)`,
          transition: start.current === null ? "transform 320ms var(--ease-out-quint)" : undefined,
        }}
        onTouchStart={(e) => {
          if (!refreshing && (scroller.current?.scrollTop ?? 0) <= 0) start.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (start.current === null) return;
          const dy = e.touches[0].clientY - start.current;
          if (dy <= 0) return setPull(0);
          setPull(dy * 0.55);
        }}
        onTouchEnd={() => {
          if (start.current === null) return;
          start.current = null;
          if (pull >= THRESHOLD) {
            setRefreshing(true);
            void Promise.resolve(onRefresh())
              .catch(() => {})
              .finally(() => window.setTimeout(() => setRefreshing(false), 250));
          }
          setPull(0);
        }}
      >
        {children}
      </div>
    </div>
  );
});
