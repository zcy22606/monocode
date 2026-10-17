/**
 * 页面栈。推入：新页从右边滑进来，下面那页往左退一点、变暗；返回反过来。
 * 每一层都一直挂着（滚动位置、草稿都在），只有最上面一层「活跃」——
 * 盖住的页面停止轮询。返回走 `back.ts` 的返回栈，安卓返回键也一样。
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { goBack, pushBack } from "./back";
import type { Draft } from "../host/host";

export type Route =
  | { name: "home" }
  | {
      name: "session";
      projectId: string;
      sessionId?: string;
      title?: string;
      /** 进页面就发的第一条消息，先显示出来。没有 sessionId 的（从首页新开的）先按 draft 建会话。 */
      start?: { text: string; draft?: Draft; commandId: string };
    }
  /** 电脑上的会话（只读）。 */
  | { name: "mirror"; id: string; projectId: string; title?: string; machine?: string }
  /** 会话里的一个文件（SOL-92）：path 是文件所在机器上的绝对路径。 */
  | { name: "file"; source: "mirror" | "host"; id: string; path: string }
  /** 一个 issue（SOL-100）：cwd 是项目目录（经网关问电脑），projectId 是主机上的项目（选模型、开会话页用）。 */
  | { name: "issue"; cwd: string; id: number; ident: string; projectId: string }
  /** 电脑 / 主机上跑着的本地服务（SOL-97）：url 是手机能连的地址，port 是那台机器上的端口。 */
  | { name: "web"; source: "mirror" | "host"; id: string; port: number; path: string };

type Entry = { key: string; route: Route };
type Nav = { push: (route: Route) => void; back: () => void };

const NavContext = createContext<Nav>({ push: () => {}, back: () => {} });
const ActiveContext = createContext(true);
export const useNav = () => useContext(NavContext);
/** 这一屏是不是在最上面（被盖住时停掉轮询和动画）。 */
export const useActive = () => useContext(ActiveContext);

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/** 只清掉滑动留下的效果（这一层自己和它的遮罩）；页面里的转圈、闪烁这些 CSS 动画不能跟着清，清了就不再动。 */
function settle(el: HTMLElement | undefined) {
  for (const a of el?.getAnimations() ?? []) a.cancel();
  for (const a of el?.querySelector<HTMLElement>("[data-shade]")?.getAnimations() ?? []) a.cancel();
}

export function Navigator({ render }: { render: (route: Route) => ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([{ key: "home", route: { name: "home" } }]);
  const [moving, setMoving] = useState<{ key: string; kind: "push" | "pop" } | null>(null);
  const layers = useRef(new Map<string, HTMLDivElement>());
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const slide = (top: string, under: string | undefined, kind: "push" | "pop") => {
    const topEl = layers.current.get(top);
    const underEl = under ? layers.current.get(under) : undefined;
    const shadeEl = underEl?.querySelector<HTMLElement>("[data-shade]");
    settle(topEl);
    settle(underEl);
    // 动画不留 fill：终点先写进内联样式，动画放完就停在那儿。留着 fill 的动画有时清不掉（getAnimations 里找不到），
    // 返回后下面那层会一直卡在左边、蒙着黑
    if (topEl) topEl.style.transform = kind === "push" ? "" : "translateX(100%)";
    if (underEl) underEl.style.transform = kind === "push" ? "translateX(-22%)" : "";
    if (shadeEl) shadeEl.style.opacity = kind === "push" ? "1" : "";
    const options = { duration: kind === "push" ? 420 : 340, easing: EASE };
    const enter = [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }];
    const away = [{ transform: "translateX(0)" }, { transform: "translateX(-22%)" }];
    const shade = [{ opacity: 0 }, { opacity: 1 }];
    const pick = <T,>(frames: T[]) => (kind === "push" ? frames : [...frames].reverse());
    const done = topEl?.animate(pick(enter), options).finished;
    underEl?.animate(pick(away), options);
    shadeEl?.animate(pick(shade), options);
    return (done ?? Promise.resolve()).catch(() => {});
  };

  const pop = useCallback(() => {
    const s = stackRef.current;
    if (s.length < 2) return;
    const top = s[s.length - 1];
    setMoving({ key: top.key, kind: "pop" });
    const under = s[s.length - 2].key;
    void slide(top.key, under, "pop").then(() => {
      // 滑出去的那层先藏住再移走：它的动画一清就弹回原位，移走要等下一次渲染，中间会闪一下
      const gone = layers.current.get(top.key);
      if (gone) gone.style.visibility = "hidden";
      settle(layers.current.get(under));
      setStack((current) => current.filter((e) => e.key !== top.key));
      setMoving(null);
    });
  }, []);

  const push = useCallback(
    (route: Route) => {
      const key = crypto.randomUUID();
      setStack((s) => [...s, { key, route }]);
      setMoving({ key, kind: "push" });
      pushBack(pop);
    },
    [pop],
  );

  // 新的一层挂上之后再开始滑
  useLayoutEffect(() => {
    if (moving?.kind !== "push") return;
    const s = stackRef.current;
    const under = s[s.length - 2]?.key;
    void slide(moving.key, under, "push").then(() => {
      // 下面那层已经藏起来，内联的位移留着给返回动画接着用
      setMoving((m) => (m?.key === moving.key ? null : m));
    });
  }, [moving]);

  const nav = useMemo<Nav>(() => ({ push, back: () => void goBack() }), [push]);
  // 在模拟器里测试用：localStorage.soloyardDebug = "1" 时，调试协议里可以直接 __soloyardNav.push(...) 开页面
  useEffect(() => {
    if (localStorage.getItem("soloyardDebug") === "1") (window as unknown as { __soloyardNav?: Nav }).__soloyardNav = nav;
  }, [nav]);
  const topIndex = stack.length - 1;

  return (
    <NavContext.Provider value={nav}>
      <div className="relative h-full overflow-hidden">
        {stack.map((entry, i) => {
          const isTop = i === topIndex;
          // 正在滑的时候，下面那一层也要看得见
          const showUnder = !!moving && i === topIndex - 1;
          const visible = isTop || showUnder;
          return (
            <div
              key={entry.key}
              ref={(el) => {
                if (el) layers.current.set(entry.key, el);
                else layers.current.delete(entry.key);
              }}
              className="absolute inset-0 bg-background-base"
              style={{
                visibility: visible ? "visible" : "hidden",
                zIndex: i,
                willChange: moving ? "transform" : undefined,
                boxShadow: i > 0 && visible ? "-12px 0 32px rgba(0,0,0,0.35)" : undefined,
              }}
              aria-hidden={!isTop}
              inert={!isTop || (moving?.kind === "pop" && moving.key === entry.key)}
            >
              <ActiveContext.Provider value={isTop && !(moving?.kind === "pop" && moving.key === entry.key)}>
                {render(entry.route)}
              </ActiveContext.Provider>
              <div data-shade className="pointer-events-none absolute inset-0 bg-black/40 opacity-0" />
            </div>
          );
        })}
      </div>
    </NavContext.Provider>
  );
}
