import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PtDocView } from "./DocBlocks";

it("SCHEMA 的每种块都能渲染，奇怪的块退回原始 JSON", () => {
  const doc = {
    title: "立项卡",
    meta: ["日期 2026-09-30"],
    lead: [{ type: "callout", tone: "warn", text: "4 项闸门未过，见 D-2" }],
    sections: [
      {
        title: "结论",
        blocks: [
          { type: "text", text: "**先做**自用切片\n\n第二段 E-3" },
          { type: "list", ordered: true, items: ["a", { text: "b", items: ["c"] }] },
          { type: "kv", items: [{ k: "情境", v: "通勤" }] },
          { type: "table", columns: ["Push", "Pull"], rows: [["x E-222", "y"]], caption: "四力" },
          { type: "cards", items: [{ title: "画像", badge: "主", text: "t", kv: [{ k: "a", v: "b" }] }] },
          { type: "checklist", items: [{ text: "闸门", state: "fail", note: "缺" }] },
          { type: "details", summary: "更多", blocks: [{ type: "code", text: "x = 1", lang: "py" }] },
          { type: "quote", text: "原话", source: "App Store" },
          { type: "decision_ref", ids: ["D-2", "D-9"] },
          { type: "chart", kind: "line", title: "收入", x: ["M1"], series: [{ name: "乐观", values: [3] }] },
          { type: "features_table" },
          { type: "mystery", foo: 1 },
          { type: "table", columns: "坏" },
          null,
        ],
        sections: [{ title: "子节", collapsed: true, blocks: [{ type: "text", text: "折叠" }] }],
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(PtDocView, {
      doc,
      decisions: new Map([["D-2", { id: "D-2", title: "首要人群" }]]),
      onRef: () => undefined,
      onOpenFeatures: () => undefined,
    }),
  );
  for (const text of ["4 项闸门未过", "先做", "第二段", "<ol", "情境", "四力", "画像", "闸门", "x = 1", "原话", "首要人群", "D-9", "收入", "乐观", "折叠", "&quot;mystery&quot;", "&quot;坏&quot;"]) {
    expect(html).toContain(text);
  }
  // 引用变成按钮
  expect(html).toMatch(/<button[^>]*>E-222<\/button>/);
});
