/**
 * Soloyard：输入框的「已发送消息」历史。
 * - ↑ / ↓ 在当前会话发过的消息和正在写的草稿之间切换（历史直接从会话的 user 块里取，不另外存）。
 * - Esc 停下正在跑的一轮时，把刚发的那条和还在排队的消息放回输入框。
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
type Field = { value: string; selectionStart: number; selectionEnd: number };

/**
 * ↑ 只在光标处在第一行时翻历史，↓ 只在最后一行时往回翻，其余时候照常移动光标。
 * 返回 null = 不处理这个按键。翻到的这条改过之后再按 ↑，改过的内容当成新的草稿。
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
  const rest = up ? field.value.slice(0, field.selectionStart) : field.value.slice(field.selectionEnd);
  if (rest.includes("\n")) return null;

  const at: HistoryNav =
    nav.index != null && field.value === nav.shown ? nav : { index: null, draft: field.value, shown: field.value };
  if (!up && at.index == null) return null;
  const entries = history();
  const index = up ? (at.index ?? entries.length) - 1 : at.index! + 1;
  if (index < 0) return null;
  if (index >= entries.length) return { nav: IDLE_HISTORY_NAV, text: at.draft, caret: at.draft.length };
  const text = entries[index];
  return { nav: { index, draft: at.draft, shown: text }, text, caret: up ? 0 : text.length };
}

// ---- Esc：停下后把发出去的消息放回输入框 ----

export type RestoreDraftRequest = {
  sessionId: string;
  text: string;
  attachments: Attachment[];
  /** 属于对话里那条消息的附件，输入框只借用、不负责释放。 */
  borrowedIds: ReadonlySet<string>;
  /** 输入框接下了才调：把排队的消息从队列里拿掉。 */
  take: () => void;
};

const RESTORE_EVENT = "soloyard:restore-draft";

/** Esc 停下之前调用（拿的是停之前的会话）：最后一条发出去的消息 + 排队的消息。 */
export function restoreDraftRequest(
  session: Session,
  take: (queuedIds: string[]) => void,
): RestoreDraftRequest | null {
  const last = [...session.blocks].reverse().find(isSentPrompt);
  const queued = (session.queuedMessages ?? []).filter(
    (message) => !message.monoSessionCompletion && !message.noteCard && !message.handoffCard,
  );
  const texts = [...(last ? [userText(last)] : []), ...queued.map((message) => message.text)].filter((text) => text.trim());
  if (!texts.length) return null;
  const borrowed = last?.attachments ?? [];
  return {
    sessionId: session.id,
    text: texts.join("\n\n"),
    attachments: [...borrowed, ...queued.flatMap((message) => message.attachments)],
    borrowedIds: new Set(borrowed.map((file) => file.id)),
    take: () => {
      if (queued.length) take(queued.map((message) => message.id));
    },
  };
}

export function requestRestoreDraft(request: RestoreDraftRequest) {
  window.dispatchEvent(new CustomEvent(RESTORE_EVENT, { detail: request }));
}

export function onRestoreDraft(sessionId: string, handler: (request: RestoreDraftRequest) => void): () => void {
  const listener = (event: Event) => {
    const request = (event as CustomEvent<RestoreDraftRequest>).detail;
    if (request.sessionId === sessionId) handler(request);
  };
  window.addEventListener(RESTORE_EVENT, listener);
  return () => window.removeEventListener(RESTORE_EVENT, listener);
}
