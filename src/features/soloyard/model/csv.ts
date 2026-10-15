// Soloyard: CSV / TSV preview in the file editor.

/**
 * RFC 4180 rows: a quoted field may hold the delimiter, `""` and line breaks.
 * Stops after `limit` rows so a big file only costs what the table shows;
 * `more` says rows were left out. Blank lines are skipped.
 */
export function parseCsv(
  text: string,
  delimiter: string,
  limit = Infinity,
): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
      if (rows.length === limit) {
        return { rows, more: text.slice(i + 1).trim() !== "" };
      }
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return { rows, more: false };
}

const NUMBER = /^[-+]?(\d[\d,]*)?\.?\d+(e[-+]?\d+)?%?$/i;

/** A column whose every filled cell is a number, so it right-aligns like a spreadsheet. */
export function isNumericColumn(body: string[][], column: number): boolean {
  let filled = false;
  for (const row of body) {
    const value = row[column]?.trim();
    if (!value) continue;
    if (!NUMBER.test(value)) return false;
    filled = true;
  }
  return filled;
}
