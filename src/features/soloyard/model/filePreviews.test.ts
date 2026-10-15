import { describe, expect, it } from "vitest";
import {
  isPdfPath,
  isUnreadableTextError,
  previewKindForPath,
  previewUrlPath,
} from "./filePreviews";
import { jsonTokens, splitRecords } from "./jsonl";

describe("previewKindForPath", () => {
  it("picks a preview by extension", () => {
    expect(previewKindForPath("/p/Data.CSV")).toBe("csv");
    expect(previewKindForPath("/p/data.tsv")).toBe("tsv");
    expect(previewKindForPath("/p/log.ndjson")).toBe("jsonl");
    expect(previewKindForPath("/p/flow.mmd")).toBe("mermaid");
    expect(previewKindForPath("/p/index.htm")).toBe("html");
    expect(previewKindForPath("/p/a.json")).toBeNull();
    expect(previewKindForPath("/p/.html.d/x")).toBeNull();
    expect(isPdfPath("/p/spec.PDF")).toBe(true);
  });
});

describe("previewUrlPath", () => {
  const decode = (token: string) =>
    new TextDecoder().decode(
      Uint8Array.from(atob(token.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      ),
    );

  it("roots project files at the project and encodes each segment", () => {
    const [token, ...rest] = previewUrlPath(
      "/Users/me/项目/proto/a b.html",
      "/Users/me/项目",
    ).split("/");
    expect(decode(token)).toBe("/Users/me/项目");
    expect(rest).toEqual(["proto", "a%20b.html"]);
  });

  it("roots a file outside the project at its folder", () => {
    const [token, ...rest] = previewUrlPath("/tmp/x/report.html", "/Users/me/p").split("/");
    expect(decode(token)).toBe("/tmp/x");
    expect(rest).toEqual(["report.html"]);
  });
});

describe("isUnreadableTextError", () => {
  it("matches the text reader's binary, encoding and size errors only", () => {
    expect(isUnreadableTextError("Binary files cannot be edited.")).toBe(true);
    expect(isUnreadableTextError("File is not valid UTF-8.")).toBe(true);
    expect(isUnreadableTextError("File is too large to edit (maximum 8 MB).")).toBe(true);
    expect(isUnreadableTextError("/x: No such file or directory")).toBe(false);
  });
});

describe("jsonl", () => {
  it("keeps line numbers, skips blank lines and stops at the limit", () => {
    expect(splitRecords('{"a":1}\n\n{"b":2}\n', 5)).toEqual({
      records: [
        { line: 1, text: '{"a":1}' },
        { line: 3, text: '{"b":2}' },
      ],
      more: false,
    });
    expect(splitRecords("1\n2\n3", 2).more).toBe(true);
    expect(splitRecords("1\n2\n\n", 2).more).toBe(false);
  });

  it("tells keys from string values, numbers and literals", () => {
    const kinds = jsonTokens('{"id": 12, "ok": true, "name": "a\\"b"}')
      .filter((token) => token.kind !== "plain")
      .map((token) => `${token.kind}:${token.text}`);
    expect(kinds).toEqual([
      'key:"id"',
      "number:12",
      'key:"ok"',
      "literal:true",
      'key:"name"',
      'string:"a\\"b"',
    ]);
  });
});
