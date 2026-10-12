import { describe, expect, it } from "vitest";
import { asPtDoc, blockKind, chartToTable, decisionIndex, linkRefsInMarkdown, parseInline, sortDocs, splitRefs, type DocEntry } from "./docs";

describe("D-x / E-x 引用", () => {
  it("认决策和证据编号，不认功能编号里的", () => {
    expect(splitRefs("见 D-12、E-3 和 E-V-014，DF-08；FEED-001 和 PRD-1 不算")).toEqual([
      "见 ",
      { ref: "D-12", kind: "decision" },
      "、",
      { ref: "E-3", kind: "evidence" },
      " 和 ",
      { ref: "E-V-014", kind: "evidence" },
      "，",
      { ref: "DF-08", kind: "decision" },
      "；FEED-001 和 PRD-1 不算",
    ]);
  });

  it("markdown 里只换正文，代码和已有链接不动", () => {
    const md = ["按 D-2 做", "`D-3` 和 [D-4](x) 不动", "```", "D-5", "```", "E-6"].join("\n");
    expect(linkRefsInMarkdown(md)).toBe(
      ["按 [D-2](#soloyard-ref-D-2) 做", "`D-3` 和 [D-4](x) 不动", "```", "D-5", "```", "[E-6](#soloyard-ref-E-6)"].join("\n"),
    );
  });
});

describe("product-thinking 块", () => {
  it("认 SCHEMA 文档，别的 json 不认", () => {
    expect(asPtDoc({ title: "x", sections: [] })).not.toBeNull();
    expect(asPtDoc({ decisions: [] })).toBeNull();
    expect(asPtDoc([1])).toBeNull();
    expect(asPtDoc("x")).toBeNull();
  });

  it("块类型对不上字段的当原始 JSON", () => {
    expect(blockKind({ type: "text", text: "a" })).toBe("text");
    expect(blockKind({ type: "text" })).toBe("raw");
    expect(blockKind({ type: "table", columns: ["a"], rows: [["1"]] })).toBe("table");
    expect(blockKind({ type: "table", columns: ["a"], rows: ["1"] })).toBe("raw");
    expect(blockKind({ type: "decision_ref", ids: ["D-1"] })).toBe("decision_ref");
    expect(blockKind({ type: "mystery" })).toBe("raw");
    expect(blockKind(null)).toBe("raw");
    expect(blockKind("text")).toBe("raw");
  });

  it("图表转表格", () => {
    expect(chartToTable({ type: "chart", title: "收入", x: ["M1", "M2"], unit: "元", series: [{ name: "乐观", values: [1, 2] }, { name: "保守", values: [0] }] })).toEqual({
      caption: "收入",
      columns: ["", "乐观 (元)", "保守 (元)"],
      rows: [["M1", "1", "0"], ["M2", "2", ""]],
    });
  });

  it("决策表按编号和别名查标题", () => {
    const index = decisionIndex({ decisions: [{ id: "D-2", title: "首要人群", aliases: ["DF-08"] }, { title: "没编号" }] });
    expect(index.get("D-2")?.title).toBe("首要人群");
    expect(index.get("DF-08")?.id).toBe("D-2");
    expect(index.size).toBe(2);
    expect(decisionIndex(null).size).toBe(0);
  });

  it("行内标记", () => {
    expect(parseInline("**粗** 见 E-1\n`c` [链](https://a.b)")).toEqual([
      { t: "bold", text: "粗" },
      { t: "text", text: " 见 " },
      { t: "ref", ref: "E-1", kind: "evidence" },
      { t: "br" },
      { t: "code", text: "c" },
      { t: "text", text: " " },
      { t: "link", text: "链", href: "https://a.b" },
    ]);
  });
});

it("列表排序：overview 在前，根目录先于子目录", () => {
  const doc = (rel: string): DocEntry => {
    const i = rel.lastIndexOf("/");
    return { rel, path: `/p/docs/${rel}`, dir: i < 0 ? "" : rel.slice(0, i), name: rel.slice(i + 1), kind: "md", mtimeMs: 0 };
  };
  expect(sortDocs(["b/x.md", "z.md", "a.md", "overview.md", "a/y.json"].map(doc)).map((d) => d.rel)).toEqual(["overview.md", "a.md", "z.md", "a/y.json", "b/x.md"]);
});

it("引用锚点经过底座 markdown 的清洗还在（外层按 href 接管点击）", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AgentMarkdown } = await import("../../sessions/ui/AgentMarkdown");
  const markup = renderToStaticMarkup(createElement(AgentMarkdown, { text: linkRefsInMarkdown("按 D-2 做，见 E-V-14") }));
  expect(markup).toContain('href="#soloyard-ref-D-2"');
  expect(markup).toContain('href="#soloyard-ref-E-V-14"');
});
