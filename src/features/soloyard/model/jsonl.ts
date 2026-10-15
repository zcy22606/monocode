// Soloyard: JSONL / NDJSON preview.

export type JsonlRecord = { line: number; text: string };

/** Non-blank lines with their line numbers, stopping after `limit` records. */
export function splitRecords(
  text: string,
  limit: number,
): { records: JsonlRecord[]; more: boolean } {
  const records: JsonlRecord[] = [];
  let start = 0;
  let line = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    line += 1;
    const value = text.slice(start, end).trim();
    if (value) {
      if (records.length === limit) return { records, more: true };
      records.push({ line, text: value });
    }
    start = end + 1;
  }
  return { records, more: false };
}

export type JsonToken = {
  text: string;
  kind: "key" | "string" | "number" | "literal" | "plain";
};

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Colors JSON text without parsing it, so a cut-off or broken line still reads. */
export function jsonTokens(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) {
      tokens.push({ text: text.slice(last, match.index), kind: "plain" });
    }
    if (match[1] !== undefined) {
      tokens.push({ text: match[1], kind: match[2] ? "key" : "string" });
      if (match[2]) tokens.push({ text: match[2], kind: "plain" });
    } else {
      tokens.push({
        text: match[0],
        kind: /^[tfn]/.test(match[0]) ? "literal" : "number",
      });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: "plain" });
  return tokens;
}
