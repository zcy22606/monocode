// Soloyard investigation: characterization only, not a native IME acceptance test.
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Composer } from "../../src/features/sessions/ui/Composer";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

it("characterizes draft write-back when a parent refresh and composition input share a batch", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let refreshParent = () => {};
  let cachedDraft = "";
  function Parent() {
    const draft = useRef("");
    const [, setTick] = useState(0);
    refreshParent = () => setTick((tick) => tick + 1);
    return createElement(Composer, {
      focused: false,
      busy: true,
      harness: "codex",
      model: "",
      runtimeMode: "supervised",
      executionCwd: "~",
      initialDraft: draft.current,
      hideTopBar: true,
      onDraftChange: (text) => { draft.current = text; cachedDraft = text; },
      onFocus: () => {},
      onCwdChange: () => {},
      onModelChange: () => {},
      onRuntimeModeChange: () => {},
      onSubmit: () => {},
    });
  }
  try {
    await act(async () => root.render(createElement(Parent)));
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      textarea.value = "你好";
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: "你好" }));
    });
    expect(cachedDraft).toBe("你好");
    // Control: a normal parent refresh with no overlapping keystroke is safe.
    // Leave this parent refresh for a separate mount below; refreshing here
    // would consume the delayed initialDraft update and hide the race.
    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      refreshParent();
      textarea.value = "你好shi";
      textarea.dispatchEvent(new InputEvent("input", {
        bubbles: true, data: "shi", isComposing: true, inputType: "insertCompositionText",
      }));
    });
    console.log(JSON.stringify({ case: "overlapping-parent-refresh", dom: textarea.value, cachedDraft }));
    // Records the current defect. A fix should preserve the native preedit text.
    expect(textarea.value).toBe("你好");
    expect(cachedDraft).toBe("你好shi");
    await act(async () => refreshParent());
    console.log(JSON.stringify({ case: "next-parent-refresh", dom: textarea.value, cachedDraft }));
    expect(textarea.value).toBe("你好shi");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("preserves preedit when a parent echoes exactly the current DOM value", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (initialDraft: string) => root.render(createElement(Composer, {
    focused: false, busy: true, harness: "codex", model: "",
    runtimeMode: "supervised", executionCwd: "~", initialDraft, hideTopBar: true,
    onFocus: () => {}, onCwdChange: () => {}, onModelChange: () => {},
    onRuntimeModeChange: () => {}, onSubmit: () => {},
  }));
  try {
    await act(async () => render("你好"));
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      textarea.value = "你好shi";
      textarea.dispatchEvent(new InputEvent("input", {
        bubbles: true, data: "shi", isComposing: true, inputType: "insertCompositionText",
      }));
    });
    await act(async () => render("你好shi"));
    expect(textarea.value).toBe("你好shi");
    expect(textarea.defaultValue).toBe("你好");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
