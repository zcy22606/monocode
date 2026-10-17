import { describe, expect, it, vi } from "vitest";
import type { Block, Session } from "../../sessions/model/session";
import { IDLE_HISTORY_NAV, historyStep, queuedRestoreRequest, sentPrompts, unansweredRestoreRequest } from "./composerHistory";

const user = (text: string, extra: Partial<Block> = {}) => ({ id: text, role: "user", text, ...extra }) as Block;
const agent = (text: string) => ({ id: `a-${text}`, role: "assistant", text }) as Block;
const key = (name: string) => ({ key: name, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false });
const field = (value: string, caret = value.length) => ({
  value,
  selectionStart: caret,
  selectionEnd: caret,
  // hard line breaks stand in for the measured visual lines
  onEdgeLine: (up: boolean) => !(up ? value.slice(0, caret) : value.slice(caret)).includes("\n"),
  draft: () => ({ text: value, attachments: [], borrowedIds: new Set<string>() }),
});
const texts = (prompts: { text: string }[]) => prompts.map((prompt) => prompt.text);

describe("sent prompts", () => {
  it("keeps the user's own messages, drops internal ones, repeats and the @link context", () => {
    const blocks = [
      user("one"),
      agent("ok"),
      user("one"),
      user("hidden", { internal: true }),
      user("two\n\n<soloyard_context>\nstuff\n</soloyard_context>"),
    ];
    expect(texts(sentPrompts(blocks))).toEqual(["one", "two"]);
  });

  it("includes `!` commands, written the way they were typed", () => {
    const shell = { id: "c", role: "shell", text: "git status", shell: { cwd: "/repo", status: "done" } } as Block;
    expect(texts(sentPrompts([user("one"), shell, agent("ok"), user("two")]))).toEqual(["one", "!git status", "two"]);
  });

  it("keeps the images a message was sent with", () => {
    const attachments = [{ id: "img" }] as Block["attachments"];
    expect(sentPrompts([user("look", { attachments }), user("look")])).toEqual([
      { text: "look", attachments },
      { text: "look", attachments: [] },
    ]);
  });
});

describe("history step", () => {
  const shot = [{ id: "shot" }] as NonNullable<Block["attachments"]>;
  const history = () => [
    { text: "first", attachments: [] },
    { text: "second\nline", attachments: shot },
  ];

  it("walks up through history and back down to the draft", () => {
    const up1 = historyStep(key("ArrowUp"), field("draft"), IDLE_HISTORY_NAV, history)!;
    expect(up1).toMatchObject({ text: "second\nline", attachments: shot, caret: 11 });
    expect([...up1.borrowedIds]).toEqual(["shot"]);
    // caret on the last line of a multi-line entry: ↑ moves the caret first
    expect(historyStep(key("ArrowUp"), field(up1.text), up1.nav, history)).toBeNull();
    const up2 = historyStep(key("ArrowUp"), field(up1.text, 3), up1.nav, history)!;
    expect(up2.text).toBe("first");
    expect(historyStep(key("ArrowUp"), field("first", 0), up2.nav, history)).toBeNull();
    const down1 = historyStep(key("ArrowDown"), field("first"), up2.nav, history)!;
    expect(down1).toMatchObject({ text: "second\nline", caret: 11 });
    const down2 = historyStep(key("ArrowDown"), field(down1.text), down1.nav, history)!;
    expect(down2).toMatchObject({ text: "draft", attachments: [], nav: IDLE_HISTORY_NAV });
  });

  it("leaves the arrows alone inside multi-line text, with modifiers, or when not browsing", () => {
    expect(historyStep(key("ArrowUp"), field("a\nb"), IDLE_HISTORY_NAV, history)).toBeNull();
    expect(historyStep({ ...key("ArrowUp"), shiftKey: true }, field(""), IDLE_HISTORY_NAV, history)).toBeNull();
    expect(historyStep(key("ArrowDown"), field("x"), IDLE_HISTORY_NAV, history)).toBeNull();
  });

  it("brings the draft's own files back with it", () => {
    const pasted = [{ id: "pasted" }] as NonNullable<Block["attachments"]>;
    const draft = { ...field("mine"), draft: () => ({ text: "mine", attachments: pasted, borrowedIds: new Set<string>() }) };
    const up = historyStep(key("ArrowUp"), draft, IDLE_HISTORY_NAV, history)!;
    const back = historyStep(key("ArrowDown"), field(up.text), up.nav, history)!;
    expect(back).toMatchObject({ text: "mine", attachments: pasted });
    expect(back.borrowedIds.size).toBe(0);
  });

  it("treats an edited recalled message as the new draft", () => {
    const up = historyStep(key("ArrowUp"), field(""), IDLE_HISTORY_NAV, history)!;
    expect(historyStep(key("ArrowUp"), field("a\nchanged"), up.nav, history)).toBeNull();
    const edited = historyStep(key("ArrowUp"), field("changed", 0), up.nav, history)!;
    expect(edited.text).toBe("second\nline");
    const back = historyStep(key("ArrowDown"), field(edited.text), edited.nav, history)!;
    expect(back.text).toBe("changed");
  });
});

describe("restore after Esc", () => {
  const session = (blocks: Block[], queuedMessages?: unknown[]) => ({ id: "s", blocks, queuedMessages }) as unknown as Session;

  it("pulls queued messages back, dequeuing only the ones it restored", () => {
    const dequeue = vi.fn();
    const request = queuedRestoreRequest(
      session([user("latest")], [
        { id: "q1", text: "next", attachments: [] },
        { id: "q2", text: "note", attachments: [], noteCard: {} },
        { id: "q3", text: "more", attachments: [] },
      ]),
      dequeue,
    )!;
    expect(request).toMatchObject({ text: "next\n\nmore", merge: true });
    request.take();
    expect(dequeue).toHaveBeenCalledWith(["q1", "q3"]);
    expect(queuedRestoreRequest(session([user("latest")]), dequeue)).toBeNull();
  });

  it("puts the last message back only while the agent has not answered it", () => {
    const attachments = [{ id: "f1" }] as Block["attachments"];
    const waiting = unansweredRestoreRequest(
      session([user("old"), agent("x"), user("latest", { attachments }), { id: "sys", role: "system", text: "…" } as Block]),
    )!;
    expect(waiting).toMatchObject({ text: "latest", merge: false });
    expect([...waiting.borrowedIds]).toEqual(["f1"]);
    expect(unansweredRestoreRequest(session([user("latest"), agent("working on it")]))).toBeNull();
    expect(unansweredRestoreRequest(session([user("latest"), { id: "t", role: "tool", text: "" } as Block]))).toBeNull();
    expect(unansweredRestoreRequest(session([]))).toBeNull();
    // Stopping a `!` command run after it does not hand the message back.
    const shell = { id: "c", role: "shell", text: "npm test", shell: { cwd: "/repo", status: "running" } } as Block;
    expect(unansweredRestoreRequest(session([user("latest"), shell]))).toBeNull();
  });
});
