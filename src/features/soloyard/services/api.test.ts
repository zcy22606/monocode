import { describe, expect, it } from "vitest";
import { shortCommand, uptime } from "./api";

describe("services", () => {
  it("shortens commands", () => {
    expect(shortCommand("node /Users/me/.nvm/versions/node/v24/bin/pnpm dev")).toBe("pnpm dev");
    expect(shortCommand("npm run tauri dev")).toBe("npm run tauri dev");
    expect(shortCommand("/Library/Python.app/Contents/MacOS/Python /x/pt.py serve --port 8766")).toBe(
      "Python pt.py serve --port 8766",
    );
  });

  it("buckets uptime", () => {
    const now = 1_000_000 * 1000;
    expect(uptime(1_000_000 - 45, now)).toEqual({ unit: "s", count: 45 });
    expect(uptime(1_000_000 - 125, now)).toEqual({ unit: "m", count: 2 });
    expect(uptime(1_000_000 - 7300, now)).toEqual({ unit: "h", count: 2 });
    expect(uptime(1_000_000 - 3 * 86400, now)).toEqual({ unit: "d", count: 3 });
  });
});
