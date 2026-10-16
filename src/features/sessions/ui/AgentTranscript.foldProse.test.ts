// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function tool(id: string): Block {
  return {
    id,
    role: "tool",
    text: `Inspect ${id}`,
    tool: { kind: "shell", status: "completed" },
  };
}

describe("prose folded into the work trail", () => {
  // Soloyard: the agent's words never fold (only its work does), so the note
  // is on screen as it is, beside the answer, with no fold to open.
  it("leaves a mid-turn note on screen, unmarked, beside the answer", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Keep me posted" },
      tool("t1"),
      { id: "note", role: "assistant", text: "Trying the other config." },
      tool("t2"),
      {
        id: "answer",
        role: "assistant",
        text: "The investigation is complete.",
      },
    ];
    act(() => root.render(createElement(AgentTranscript, { blocks })));

    expect(
      container.querySelector('button[aria-label="Show the work"]'),
    ).toBeNull();
    expect(container.querySelector(".zen-fold-prose")).toBeNull();
    expect(container.textContent).toContain("Trying the other config.");
    expect(container.textContent).toContain("The investigation is complete.");
  });
});
