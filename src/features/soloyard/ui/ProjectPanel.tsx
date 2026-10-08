/**
 * Soloyard：右侧项目面板（SOL-66）。侧栏（可拖宽度）/ 满屏（盖住会话区域）/ 悬浮（可拖位置和大小）三种样子，
 * 挂在 App 的 <main> 里，所以满屏和悬浮都只在会话区域内。
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { useTranslation } from "../../../i18n";
import { looksLikeProject } from "../../projects/model/recents";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { suppressTextSelection } from "../../../shared/lib/drag";
import { ChevronDown, ChevronLeft, Maximize2, Minimize2, PanelRight, PictureInPicture } from "../../../shared/ui/icons";
import {
  backProjectPanel,
  clampFloatRect,
  exitProjectPanelFull,
  openInProjectPanel,
  PANEL_DEFAULT_WIDTH,
  panelShown,
  retargetProjectPanel,
  selectProjectPanelView,
  setProjectPanelFloat,
  setProjectPanelWidth,
  toggleProjectPanelFloat,
  toggleProjectPanelFull,
  useProjectPanel,
  type FloatRect,
  type PanelMode,
} from "../model/projectPanel";
import { navOf, onOpenProjectView, PANEL_VIEWS, viewLabel, type ProjectViewId } from "../model/projectViews";
import { Popover } from "../../../shared/ui/Popover";
import { ProjectViewIcon } from "./ProjectViewIcon";
import { ProjectViewSurface } from "./ProjectViewSurface";

const MIN_WIDTH = 360;

/** cwd：当前项目，面板跟着它换；focus：主区域正在显示什么（标签 + 窗格 + 文件），换了就退出满屏。 */
export function ProjectPanel({ cwd, focus, hidden = false }: { cwd: string; focus: string; hidden?: boolean }) {
  const { t } = useTranslation("soloyard");
  const panel = useProjectPanel();
  /** 做开合动画的元素：侧栏是外层（动宽度），满屏和悬浮是面板本身。 */
  const motionRef = useRef<HTMLElement | null>(null);
  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.7)),
    defaultWidth: PANEL_DEFAULT_WIDTH,
    initial: panel.width,
    direction: "left",
    onCommit: setProjectPanelWidth,
  });

  useEffect(() => onOpenProjectView(openInProjectPanel), []);
  useEffect(() => {
    if (looksLikeProject(cwd)) retargetProjectPanel(cwd);
  }, [cwd]);

  // 收起时先播完动画再卸载：动画期间照着收起前的状态渲染
  const shown = panelShown(panel);
  const [leaving, setLeaving] = useState(false);
  const lastShown = useRef(panel);
  if (shown) lastShown.current = panel;
  const view = shown ? panel : lastShown.current;
  const wasOpen = useRef(shown);
  useLayoutEffect(() => {
    const opened = shown && !wasOpen.current;
    const closed = !shown && wasOpen.current;
    wasOpen.current = shown;
    if (closed) setLeaving(true);
    const el = motionRef.current;
    if (!el || !(opened || closed)) return;
    const animation = playPanelMotion(el, view.mode, closed);
    if (!animation) {
      if (closed) setLeaving(false);
      return;
    }
    if (closed) animation.onfinish = () => setLeaving(false);
    return () => animation.cancel();
  }, [shown]);

  // 换样子（满屏 / 侧栏 / 悬浮）：点按钮时记下原来的位置，新元素挂上后从那里过渡过去
  const switchFrom = useRef<{ rect: DOMRect; mode: PanelMode } | null>(null);
  const switchMode = (toggle: () => void) => () => {
    const el = motionRef.current;
    switchFrom.current = el ? { rect: el.getBoundingClientRect(), mode: view.mode } : null;
    toggle();
  };
  useLayoutEffect(() => {
    const from = switchFrom.current;
    switchFrom.current = null;
    const el = motionRef.current;
    if (!from || !el || !shown) return;
    const animation = playSwitchMotion(el, view.mode, from);
    return () => animation?.cancel();
  }, [view.mode]);

  // 打开了别的会话或文件：满屏的带动画退回侧栏（或悬浮），面板还开着
  const lastFocus = useRef(focus);
  useLayoutEffect(() => {
    if (lastFocus.current === focus) return;
    lastFocus.current = focus;
    if (!shown || panel.mode !== "full") return;
    const el = motionRef.current;
    switchFrom.current = el ? { rect: el.getBoundingClientRect(), mode: "full" } : null;
    exitProjectPanelFull();
  }, [focus]);

  const top = view.stack[view.stack.length - 1];
  // wasOpen 在收起的那次渲染里还是 true，元素留着给 effect 播动画
  if (hidden || !(shown || leaving || wasOpen.current) || !top || !looksLikeProject(view.cwd)) return null;

  const root = view.stack[0];
  const floating = view.mode === "float";
  const full = view.mode === "full";
  const title = (entry: typeof top) => entry.title || viewLabel(entry.view);

  const header = (
    <div
      className={`flex h-9 shrink-0 items-center gap-1 border-b border-stroke pr-1.5 pl-2 ${floating ? "cursor-grab" : ""}`}
      onPointerDown={floating ? (event) => dragRect(event, motionRef.current, "move") : undefined}
    >
      {view.stack.length > 1 ? (
        <IconButton label={t("panel.back")} onClick={backProjectPanel}>
          <ChevronLeft className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1 text-[12px]">
        <ViewPicker current={root.view} label={title(root)} dimmed={view.stack.length > 1} />
        {view.stack.length > 1 ? (
          <>
            <span className="shrink-0 text-content/30">/</span>
            <span className="truncate font-medium text-content">{title(top)}</span>
          </>
        ) : null}
      </div>
      <IconButton label={t(full ? "panel.exitFullscreen" : "panel.fullscreen")} onClick={switchMode(toggleProjectPanelFull)}>
        {full ? <Minimize2 className="size-3.5" strokeWidth={1.75} /> : <Maximize2 className="size-3.5" strokeWidth={1.75} />}
      </IconButton>
      <IconButton
        label={t(floating || (full && view.restoreMode === "float") ? "panel.dock" : "panel.float")}
        onClick={switchMode(toggleProjectPanelFloat)}
      >
        {floating ? <PanelRight className="size-3.5" strokeWidth={1.75} /> : <PictureInPicture className="size-3.5" strokeWidth={1.75} />}
      </IconButton>
    </div>
  );
  const body = (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <ProjectViewSurface
        key={`${view.cwd}:${top.view}:${top.itemId ?? ""}`}
        cwd={view.cwd}
        source={top}
        title={title(top)}
      />
    </div>
  );

  if (floating) {
    const rect = view.float;
    return (
      <aside
        // 悬浮和侧栏 / 满屏各用一个元素（key）：侧栏拖宽度、悬浮拖动都直接写 DOM 样式，复用会把宽度 / 位置带过来
        key="float"
        ref={motionRef}
        aria-label={t("panel.label")}
        className="absolute z-30 flex flex-col overflow-hidden rounded-lg border border-stroke bg-background-base shadow-2xl"
        // 没拖过时贴右边；拖过的位置用 CSS 夹在会话区域里，窗口变小也不会跑出去
        style={
          rect
            ? {
                left: `max(0px, min(${rect.x}px, calc(100% - ${rect.w}px)))`,
                top: `max(0px, min(${rect.y}px, calc(100% - ${rect.h}px)))`,
                width: rect.w,
                height: rect.h,
                maxWidth: "100%",
                maxHeight: "100%",
              }
            : { top: 12, right: 12, bottom: 12, width: Math.min(view.width, 560) }
        }
      >
        {header}
        {body}
        <div
          role="separator"
          aria-label={t("panel.resize")}
          className="absolute right-0 bottom-0 z-10 size-3 cursor-nwse-resize touch-none"
          onPointerDown={(event) => dragRect(event, motionRef.current, "resize")}
        />
      </aside>
    );
  }

  // 侧栏和满屏是同一个元素，满屏就是宽度占满、把会话挤到 0；开合、互换都是动外层宽度，会话跟着变宽变窄。
  // 外层裁掉露出来的部分；z-10 盖住被挤到 0 宽的会话溢出来的内容。
  return (
    <div
      key="side"
      ref={(el) => void (motionRef.current = el)}
      className={`relative z-10 flex h-full min-h-0 shrink-0 justify-end overflow-hidden bg-background-base ${full ? "w-full" : ""}`}
    >
      <aside
        ref={resize.setPaneRef}
        aria-label={t("panel.label")}
        // 满屏时盖过拖出来的宽度（那个是直接写在 style 上的）
        className={`relative flex h-full min-h-0 max-w-full shrink-0 flex-col bg-background-base ${full ? "w-full!" : "border-l border-stroke"}`}
      >
        {full ? null : (
          <div
            role="separator"
            aria-label={t("panel.resize")}
            onPointerDown={resize.onPointerDown}
            onDoubleClick={resize.onDoubleClick}
            className={`absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none ${
              resize.dragging ? "bg-content/15" : "hover:bg-content/10"
            }`}
          />
        )}
        {header}
        {body}
      </aside>
    </div>
  );
}

const OPEN_TIMING: KeyframeAnimationOptions = { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
const CLOSE_TIMING: KeyframeAnimationOptions = { duration: 160, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" };
const noMotion = (el: HTMLElement) =>
  typeof el.animate !== "function" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** 标题栏左边的视图下拉：点开换 Issues / 迭代 / 文档……，详情页时变暗当面包屑。 */
function ViewPicker({ current, label, dimmed }: { current: ProjectViewId; label: string; dimmed: boolean }) {
  const { t } = useTranslation("soloyard");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={t("panel.switchView")}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        className={`flex h-6.5 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 ${dimmed ? "text-content/50" : "font-medium text-content"}`}
      >
        <ProjectViewIcon view={current} className="size-3.5 shrink-0 text-content/50" />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 text-content/45" strokeWidth={2} />
      </button>
      {anchor ? (
        <Popover anchor={anchor} side="bottom" align="start" width={200} onDismiss={() => setAnchor(null)} role="menu" aria-label={t("panel.switchView")}>
          <div className="flex flex-col p-1">
            {PANEL_VIEWS.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={navOf(current) === id}
                onClick={() => {
                  setAnchor(null);
                  selectProjectPanelView(id);
                }}
                className={`flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] ${
                  navOf(current) === id ? "bg-selection text-content" : "text-content/75 hover:bg-content/10 hover:text-content"
                }`}
              >
                <ProjectViewIcon view={id} className="size-3.5 shrink-0" />
                {viewLabel(id)}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/** 开 / 收的动画，时长和缓动照上游侧栏抽屉。系统设了减少动态效果就不播。 */
function playPanelMotion(el: HTMLElement, mode: PanelMode, closing: boolean): Animation | null {
  if (noMotion(el)) return null;
  if (mode === "float") {
    const frames: Keyframe[] = [{ opacity: 0, transform: "translateX(24px) scale(0.98)" }, { opacity: 1, transform: "none" }];
    return el.animate(closing ? frames.reverse() : frames, closing ? CLOSE_TIMING : OPEN_TIMING);
  }
  // 侧栏 / 满屏：外层宽度在 0 和它该有的宽度之间动，会话跟着变宽变窄；里面的面板先钉住宽度，不跟着挤
  const inner = el.firstElementChild as HTMLElement | null;
  const width = el.getBoundingClientRect().width;
  const restore = inner ? pinWidth(inner, width) : () => {};
  const frames: Keyframe[] = [{ width: "0px" }, { width: `${width}px` }];
  const long = mode === "full"; // 满屏走的距离长，慢一点
  const animation = el.animate(
    closing ? frames.reverse() : frames,
    closing ? { ...CLOSE_TIMING, duration: long ? 260 : 160 } : { ...OPEN_TIMING, duration: long ? 280 : 200 },
  );
  // 收起的会卸载，不用还原；打开的播完把宽度还给拖出来的值 / 满屏的 100%
  if (!closing) {
    animation.onfinish = restore;
    animation.oncancel = restore;
  }
  return animation;
}

/** 动画期间把面板宽度钉成像素（!important 盖过满屏的 w-full!），返回还原函数。 */
function pinWidth(el: HTMLElement, width: number) {
  const value = el.style.getPropertyValue("width");
  const priority = el.style.getPropertyPriority("width");
  el.style.setProperty("width", `${width}px`, "important");
  return () => el.style.setProperty("width", value, priority);
}

/**
 * 换样子的过渡：侧栏和满屏之间动外层宽度（会话被挤窄 / 放宽，面板内容跟着排）；
 * 和悬浮之间互换就按打开的动画来。
 */
function playSwitchMotion(el: HTMLElement, mode: PanelMode, from: { rect: DOMRect; mode: PanelMode }): Animation | null {
  if (noMotion(el)) return null;
  if (mode !== "float" && from.mode !== "float") {
    return el.animate([{ width: `${from.rect.width}px` }, { width: `${el.getBoundingClientRect().width}px` }], { ...OPEN_TIMING, duration: 260 });
  }
  return playPanelMotion(el, mode, false);
}

/** 拖悬浮框的标题栏挪位置、拖右下角改大小；拖的时候直接写 DOM，松手再存。 */
function dragRect(event: ReactPointerEvent, el: HTMLElement | null, kind: "move" | "resize") {
  if (event.button !== 0 || !el) return;
  if (kind === "move" && (event.target as HTMLElement).closest("button")) return;
  const parent = el.offsetParent as HTMLElement | null;
  if (!parent) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const start: FloatRect = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  let next = start;
  const restoreSelection = suppressTextSelection();
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    next = clampFloatRect(
      kind === "move" ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy },
      parent.clientWidth,
      parent.clientHeight,
    );
    Object.assign(el.style, { left: `${next.x}px`, top: `${next.y}px`, right: "auto", bottom: "auto", width: `${next.w}px`, height: `${next.h}px` });
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    restoreSelection();
    setProjectPanelFloat(next);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}
