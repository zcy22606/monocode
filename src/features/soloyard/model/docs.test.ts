import { describe, expect, it } from "vitest";
import { asPtDoc, blockKind, chartToTable, decisionIndex, linkRefsInMarkdown, docCode, filterDocs, groupDocs, parseInline, splitRefs, type DocEntry } from "./docs";

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

describe("文档列表", () => {
  const doc = (rel: string, extra: Partial<DocEntry> = {}): DocEntry => {
    const [type, file] = rel.split("/");
    const typed = file && ["product", "specs", "adr", "reports", "archive"].includes(type);
    return {
      path: `/p/${extra.repo ? "backend/" : ""}docs/${rel}`, repo: null, repoName: null, rel, kind: "md",
      type: typed ? (type as DocEntry["type"]) : null, no: typed ? (/^(\d{2})-/.exec(file)?.[1] ?? null) : null,
      title: rel, date: "2026-09-01", dateFrom: "header", status: null, state: null, related: null, author: null, mtimeMs: 0, ...extra,
    };
  };
  const docs = [
    doc("adr/03-赛事.md", { repo: "/p/backend", repoName: "backend", date: "2026-08-24", state: "confirmed" }),
    doc("adr/01-配置源.md", { repo: "/p/backend", repoName: "backend", date: "2026-08-17" }),
    doc("product/01-立项卡.json", { date: "2026-10-01" }),
    doc("handover/OPS.md", { date: "2026-08-13" }),
    doc("archive/01-工程规范.md", { state: "superseded" }),
    doc("overview.md", { auto: true }),
  ];

  it("按类型分组，类里先根目录再仓库、按编号排，未归类最后；按仓库根目录在前；时间线按月新的在前", () => {
    const all = filterDocs(docs, { repos: new Set(), showRetired: true, q: "" });
    expect(groupDocs(all, "type").map((g) => [g.key, g.docs.map((d) => d.rel)])).toEqual([
      ["product", ["product/01-立项卡.json"]],
      ["adr", ["adr/01-配置源.md", "adr/03-赛事.md"]],
      ["archive", ["archive/01-工程规范.md"]],
      ["unsorted", ["handover/OPS.md"]],
    ]);
    expect(groupDocs(all, "repo").map((g) => [g.key, g.docs.map((d) => d.rel)])).toEqual([
      ["", ["product/01-立项卡.json", "archive/01-工程规范.md", "handover/OPS.md"]],
      ["/p/backend", ["adr/01-配置源.md", "adr/03-赛事.md"]],
    ]);
    expect(groupDocs(all, "time").map((g) => g.key)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("按编号排，不按日期：编号文件夹里按自己的序号（10 排在 02 后面），按类型时根目录在前", () => {
    const list = [
      doc("reports/01-尽调/10-附录.md", { date: "2026-08-01" }),
      doc("reports/02-复盘.md", { date: "2026-07-01" }),
      doc("reports/01-尽调/02-安全.md", { date: "2026-09-01" }),
      doc("reports/01-周报.md", { repo: "/p/backend", repoName: "backend", date: "2026-01-01" }),
    ];
    expect(groupDocs(list, "type")[0].docs.map((d) => `${d.repoName ?? "root"}:${docCode(d)}`)).toEqual(["root:reports/01/02", "root:reports/01/10", "root:reports/02", "backend:reports/01"]);
    expect(groupDocs(list, "repo")[0].docs.map((d) => docCode(d))).toEqual(["reports/01/02", "reports/01/10", "reports/02"]);
  });

  it("默认藏已废弃 / 已归档和说明书快照；按仓库、标题筛", () => {
    const visible = (f: Partial<Parameters<typeof filterDocs>[1]>) => filterDocs(docs, { repos: new Set(), showRetired: false, q: "", ...f }).map((d) => d.rel);
    expect(visible({})).not.toContain("archive/01-工程规范.md");
    expect(visible({})).not.toContain("overview.md");
    expect(visible({ repos: new Set(["/p/backend"]) })).toEqual(["adr/03-赛事.md", "adr/01-配置源.md"]);
    expect(visible({ repos: new Set([""]), q: "立项" })).toEqual(["product/01-立项卡.json"]);
    expect([docCode(docs[0]), docCode({ type: "archive", no: null, rel: "archive/x.md" }), docCode({ type: null, no: null, rel: "x.md" })]).toEqual(["adr/03", "archive", null]);
    expect(docCode({ type: "reports", no: "01", rel: "reports/01-技术尽调/03-安全策略.md" })).toBe("reports/01/03");
  });
});

it("引用锚点经过底座 markdown 的清洗还在（外层按 href 接管点击）", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AgentMarkdown } = await import("../../sessions/ui/AgentMarkdown");
  const markup = renderToStaticMarkup(createElement(AgentMarkdown, { text: linkRefsInMarkdown("按 D-2 做，见 E-V-14") }));
  expect(markup).toContain('href="#soloyard-ref-D-2"');
  expect(markup).toContain('href="#soloyard-ref-E-V-14"');
});
