import { useMemo } from "react";
import { useTranslation } from "../../../i18n";
import { formatInteger } from "../../../shared/lib/numbers";
import { isNumericColumn, parseCsv } from "../model/csv";

// ponytail: a plain table of the first ROW_LIMIT rows; virtualize if whole big files need browsing.
const ROW_LIMIT = 1000;

// Opaque so the pinned header hides the rows scrolling under it.
const HEADER_BG = "bg-background-base bg-linear-to-b from-content/6 to-content/6";

/** Soloyard: CSV / TSV preview — header pinned, row numbers, numeric columns right-aligned, long cells cut with the full text on hover. */
export function CsvPreview({
  text,
  delimiter,
}: {
  text: string;
  delimiter: string;
}) {
  const { t } = useTranslation("soloyard");
  const { rows, more } = useMemo(
    () => parseCsv(text, delimiter, ROW_LIMIT + 1),
    [text, delimiter],
  );
  const [header = [], ...body] = rows;
  const columns = useMemo(() => {
    const count = Math.max(0, ...rows.map((row) => row.length));
    return Array.from({ length: count }, (_, index) => ({
      index,
      numeric: isNumericColumn(rows.slice(1), index),
    }));
  }, [rows]);
  const align = (numeric: boolean) =>
    numeric ? "text-right tabular-nums" : "text-left";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Same height as the band the preview / source toggle floats in. */}
      <div className="flex h-10 shrink-0 items-center px-4 text-[11.5px] text-content/45">
        {rows.length === 0
          ? t("csv.empty")
          : `${t(more ? "csv.firstRows" : "csv.rows", {
              count: body.length,
              rows: formatInteger(body.length),
            })} · ${t("csv.columns", {
              count: columns.length,
              columns: formatInteger(columns.length),
            })}`}
      </div>
      {rows.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 select-text">
          <div className="w-max min-w-full overflow-clip rounded-[10px] border border-content/10">
            <table className="w-full border-separate border-spacing-0 text-[12.5px] text-content/85">
              <thead>
                <tr>
                  <th
                    className={`sticky top-0 z-10 w-px border-b border-content/10 px-3 py-2 ${HEADER_BG}`}
                  />
                  {columns.map(({ index, numeric }) => (
                    <th
                      key={index}
                      className={`sticky top-0 z-10 border-b border-l border-content/10 px-3 py-2 text-[12px] font-medium text-content/70 ${align(numeric)} ${HEADER_BG}`}
                    >
                      <Cell value={header[index]} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="hover:bg-content/4 [&:last-child>td]:border-b-0"
                  >
                    <td className="border-b border-content/5 px-3 py-1.5 text-right text-[11px] text-content/30 tabular-nums">
                      {rowIndex + 1}
                    </td>
                    {columns.map(({ index, numeric }) => (
                      <td
                        key={index}
                        className={`border-b border-l border-content/5 px-3 py-1.5 ${align(numeric)}`}
                      >
                        <Cell value={row[index]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more ? (
            <p className="pt-3 text-center text-[11.5px] text-content/45">
              {t("csv.truncated", {
                count: ROW_LIMIT,
                rows: formatInteger(ROW_LIMIT),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Cell({ value = "" }: { value?: string }) {
  return (
    <div className="max-w-80 truncate" title={value}>
      {value}
    </div>
  );
}
