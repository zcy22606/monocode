/**
 * Soloyard：输入框的「已发送消息」历史。
 * - ↑ / ↓ 在当前会话发过的消息和正在写的草稿之间切换（历史直接从会话的 user 块里取，不另外存）。
 * - Esc：有排队的消息先挪回输入框；否则停下，agent 还没回复的那条放回输入框（同 Claude Code）。
 */
import { isOperatorUserTurn, operatorUserPrompt } from "../../sessions/model/operatorCommand";
import type { Attachment, Block, Session } from "../../sessions/model/session";

function userText(block: Block): string {
  const text = isOperatorUserTurn(block) ? `/operator ${operatorUserPrompt(block)}` : block.text;
  return text.split("\n\n<soloyard_context>")[0];
}

function isSentPrompt(block: Block): boolean {
  return (
    block.role === "user" &&
    !block.internal &&
    !block.draft &&
    !block.secondOpinion &&
    !block.noteCard &&
    !block.ciContext &&
    !!block.text.trim()
  );
}

/** 当前会话发过的消息，旧的在前；连续重复的只留一条。 */
export function sentPrompts(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (!isSentPrompt(block)) continue;
    const text = userText(block);
    if (out[out.length - 1] !== text) out.push(text);
  }
  return out;
}

/** index = null 表示在编辑草稿；shown 是最后放进输入框的那条，用来发现用户改过。 */
export type HistoryNav = { index: number | null; draft: string; shown: string };
export const IDLE_HISTORY_NAV: HistoryNav = { index: null, draft: "", shown: "" };

type Key = { key: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };
/** onEdgeLine(up)：光标是否在（自动换行后的）第一行 / 最后一行，按需才量。 */
type Field = { value: string; selectionStart: number; selectionEnd: number; onEdgeLine: (up: boolean) => boolean };

/**
 * ↑ 只在光标处在第一行时翻历史，↓ 只在最后一行时往回翻，其余时候照常移动光标。
 * 翻出来的光标都放在末尾。返回 null = 不处理这个按键。
 * 翻到的这条改过之后再按 ↑，改过的内容当成新的草稿。
 */
export function historyStep(
  key: Key,
  field: Field,
  nav: HistoryNav,
  history: () => string[],
): { nav: HistoryNav; text: string; caret: number } | null {
  const up = key.key === "ArrowUp";
  if (!up && key.key !== "ArrowDown") return null;
  if (key.altKey || key.metaKey || key.ctrlKey || key.shiftKey) return null;
  if (field.selectionStart !== field.selectionEnd) return null;
  const at: HistoryNav =
    nav.index != null && field.value === nav.shown ? nav : { index: null, draft: field.value, shown: field.value };
  if (!up && at.index == null) return null;
  if (!field.onEdgeLine(up)) return null;
  const entries = history();
  const index = up ? (at.index ?? entries.length) - 1 : at.index! + 1;
  if (index < 0) return null;
  if (index >= entries.length) return { nav: IDLE_HISTORY_NAV, text: at.draft, caret: at.draft.length };
  const text = entries[index];
  return { nav: { index, draft: at.draft, shown: text }, text, caret: text.length };
}

// ---- Esc：照 Claude Code 的做法把消息放回输入框 ----
// 有排队的消息：只把排队的挪回输入框，不停（再按一次才停）。
// 没有排队的：停下；agent 对最后一条还没任何输出时，把这条放回输入框。

export type RestoreDraftRequest = {
  sessionId: string;
  text: string;
  attachments: Attachment[];
  /** 属于对话里那条消息的附件，输入框只借用、不负责释放。 */
  borrowedIds: ReadonlySet<string>;
  /** true = 排队的消息，输入框里有字也接在后面；false = 只放进空输入框。 */
  merge: boolean;
  /** 输入框接下时调；只有第一次返回 true（同一会话开在两个窗格里时只放一处）。 */
  take: () => boolean;
};

/** App 这边发出的请求，take 由 requestRestoreDraft 包成只生效一次。 */
export type RestoreDraft = Omit<RestoreDraftRequest, "take"> & { take: () => void };

const RESTORE_EVENT = "soloyard:restore-draft";

/** 有输出就算 agent 已经开始回复（system / handoff 这类状态行不算）。 */
const AGENT_OUTPUT = new Set<Block["role"]>(["assistant", "reasoning", "tool", "image", "approval", "tasks", "plan"]);

/** 最后一条发出去、agent 还没任何输出的消息。 */
function unansweredPrompt(blocks: Block[]): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (isSentPrompt(blocks[i])) return blocks[i];
    if (AGENT_OUTPUT.has(blocks[i].role)) return undefined;
  }
  return undefined;
}

/** 排队的消息挪回输入框；接下了才调 dequeue 把它们从队列拿掉。 */
export function queuedRestoreRequest(
  session: Session,
  dequeue: (queuedIds: string[]) => void,
): RestoreDraft | null {
  const queued = (session.queuedMessages ?? []).filter(
    (message) =>
      !message.monoSessionCompletion && !message.noteCard && !message.handoffCard && (message.text.trim() || message.attachments.length),
  );
  if (!queued.length) return null;
  return {
    sessionId: session.id,
    text: queued.map((message) => message.text).join("\n\n"),
    attachments: queued.flatMap((message) => message.attachments),
    borrowedIds: new Set(),
    merge: true,
    take: () => dequeue(queued.map((message) => message.id)),
  };
}

/** 停下之前调用（拿停之前的会话）：agent 还没回复的那条放回空输入框。 */
export function unansweredRestoreRequest(session: Session): RestoreDraft | null {
  const prompt = unansweredPrompt(session.blocks);
  if (!prompt) return null;
  const attachments = prompt.attachments ?? [];
  return {
    sessionId: session.id,
    text: userText(prompt),
    attachments,
    borrowedIds: new Set(attachments.map((file) => file.id)),
    merge: false,
    take: () => {},
  };
}

/** 发给这个会话的输入框，返回有没有输入框接下。 */
export function requestRestoreDraft(request: RestoreDraft): boolean {
  let taken = false;
  const take = () => {
    if (taken) return false;
    taken = true;
    request.take();
    return true;
  };
  window.dispatchEvent(new CustomEvent<RestoreDraftRequest>(RESTORE_EVENT, { detail: { ...request, take } }));
  return taken;
}

export function onRestoreDraft(sessionId: string, handler: (request: RestoreDraftRequest) => void): () => void {
  const listener = (event: Event) => {
    const request = (event as CustomEvent<RestoreDraftRequest>).detail;
    if (request.sessionId === sessionId) handler(request);
  };
  window.addEventListener(RESTORE_EVENT, listener);
  return () => window.removeEventListener(RESTORE_EVENT, listener);
}

const MIRRORED = [
  "boxSizing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "letterSpacing", "lineHeight",
  "textTransform", "wordSpacing", "textIndent", "tabSize", "wordBreak", "overflowWrap", "whiteSpace",
] as const;

/** 光标在不在自动换行后的第一行（up）/ 最后一行：拿一个同样式的隐藏 div 量光标的高度。 */
export function caretOnEdgeLine(el: HTMLTextAreaElement, up: boolean): boolean {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const prop of MIRRORED) mirror.style[prop] = style[prop];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    // clientWidth 不含滚动条，和 textarea 实际排字的宽度一致
    width: `${el.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`,
    whiteSpace: "pre-wrap",
  });
  const top = (pos: number) => {
    mirror.textContent = el.value.slice(0, pos);
    const marker = document.createElement("span");
    // 带上光标后面的字：光标在一个整体折到下一行的词中间时，量到的才是折过去的那行
    marker.textContent = el.value.slice(pos) || "\u200b";
    mirror.appendChild(marker);
    return marker.offsetTop;
  };
  document.body.appendChild(mirror);
  try {
    return top(el.selectionStart) === top(up ? 0 : el.value.length);
  } finally {
    mirror.remove();
  }
}
