import { describe, expect, it, vi } from "vitest";
import { pressToOpen } from "./pressToOpen";

const event = (over: Partial<{ button: number; detail: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  button: 0, detail: 1, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over,
});

describe("pressToOpen", () => {
  it("opens once on a plain press, not again on its click", () => {
    const open = vi.fn();
    const row = pressToOpen(open);
    row.onMouseDown(event());
    row.onClick(event());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("leaves keyboard activation and modifier clicks to the click", () => {
    const open = vi.fn();
    const row = pressToOpen(open);
    row.onClick(event({ detail: 0 }));
    row.onMouseDown(event({ metaKey: true }));
    row.onMouseDown(event({ button: 2 }));
    expect(open).toHaveBeenCalledTimes(1);
    row.onClick(event({ metaKey: true }));
    expect(open).toHaveBeenCalledTimes(2);
  });
});
