import { describe, expect, it } from "vitest";
import { isNumericColumn, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded delimiters and line breaks", () => {
    const text = 'name,note\n"Smith, J","said ""hi""\nthen left"\n\nx,\n';
    expect(parseCsv(text, ",")).toEqual({
      rows: [
        ["name", "note"],
        ["Smith, J", 'said "hi"\nthen left'],
        ["x", ""],
      ],
      more: false,
    });
  });

  it("stops at the limit and reports what was left out", () => {
    expect(parseCsv("a\nb\nc", ",", 2)).toEqual({
      rows: [["a"], ["b"]],
      more: true,
    });
    expect(parseCsv("a\nb\n\n", ",", 2).more).toBe(false);
  });

  it("splits TSV on tabs", () => {
    expect(parseCsv("a\tb,c", "\t").rows).toEqual([["a", "b,c"]]);
  });
});

describe("isNumericColumn", () => {
  it("treats a column of numbers, blanks allowed, as numeric", () => {
    const body = [
      ["1,234.5", "2026-10-15", ""],
      ["-3", "7", ""],
      ["", "x", ""],
      ["12%", "8", ""],
    ];
    expect(isNumericColumn(body, 0)).toBe(true);
    expect(isNumericColumn(body, 1)).toBe(false);
    expect(isNumericColumn(body, 2)).toBe(false);
  });
});
