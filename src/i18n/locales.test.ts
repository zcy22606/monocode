import { describe, expect, it } from "vitest";
import { i18n, systemLanguage } from ".";

/** 拍平成 `a.b.c` 路径；复数后缀去掉，因为中文只有 `_other`，英文还有 `_one`。 */
function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && child
      ? keys(child, `${prefix}${key}.`)
      : [`${prefix}${key.replace(/_(zero|one|two|few|many|other)$/, "")}`],
  );
}

function values(value: object): string[] {
  return Object.values(value).flatMap((child) =>
    typeof child === "object" && child ? values(child) : [String(child)],
  );
}

describe("locales", () => {
  const en = i18n.store.data.en;
  const zh = i18n.store.data["zh-CN"];

  it("has the same namespaces in every language", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(Object.keys(en))("zh-CN translates every key in %s", (ns) => {
    expect([...new Set(keys(zh[ns]))].sort()).toEqual(
      [...new Set(keys(en[ns]))].sort(),
    );
    expect(values(zh[ns]).filter((text) => !text.trim())).toEqual([]);
  });

  it("defaults to English and maps any Chinese system locale to zh-CN", () => {
    expect(i18n.language).toBe("en");
    expect(systemLanguage(["zh-TW", "en"])).toBe("zh-CN");
    expect(systemLanguage(["zh-Hans-CN"])).toBe("zh-CN");
    expect(systemLanguage(["en-US", "zh-CN"])).toBe("en");
    expect(systemLanguage([])).toBe("en");
  });
});
