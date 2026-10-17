/**
 * 返回栈：推入的页面和打开的底部面板各占一条浏览器历史，安卓的返回键 / 返回手势
 * 触发 popstate，总是关掉最上面那一层。界面上的返回按钮、点遮罩关面板也都走
 * `goBack()`，这样历史记录和界面永远对得上。
 */
type Closer = () => void;
const closers: Closer[] = [];
const waiting: (() => void)[] = [];

window.addEventListener("popstate", () => {
  closers.pop()?.();
  for (const resolve of waiting.splice(0)) resolve();
});

/** 打开一层；返回键按下时调 close。 */
export function pushBack(close: Closer) {
  closers.push(close);
  history.pushState({ depth: closers.length }, "");
}

/** 关掉最上面一层，等历史记录真的退回去再 resolve（之后再推新的一层才不会乱序）。 */
export function goBack(): Promise<void> {
  if (!closers.length) return Promise.resolve();
  return new Promise((resolve) => {
    waiting.push(resolve);
    history.back();
  });
}

export const backDepth = () => closers.length;
