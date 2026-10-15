import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "../../../i18n";
import { basename, openPathWithDefaultApp } from "../../../platform/tauri/fs";
import { formatInteger } from "../../../shared/lib/numbers";
import { ChevronRight, ExternalLink, RotateCcw } from "../../../shared/ui/icons";
import { FileCard } from "../../files/ui/BinaryFileView";
import { FilePreviewSearch } from "../../files/ui/FilePreviewSearch";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { MarkdownDocumentPreview } from "../../sessions/ui/MarkdownDocumentPreview";
import type { PreviewKind } from "../model/filePreviews";
import { jsonTokens, splitRecords, type JsonToken } from "../model/jsonl";
import { CsvPreview } from "./CsvPreview";
import { frameUrl } from "./PdfPreview";

// ponytail: like the CSV table, only the first RECORD_LIMIT records render.
const RECORD_LIMIT = 1000;
// FileEditor autosaves 1 s (FILE_EDITOR_AUTOSAVE_DELAY_MS) after the last edit.
const SAVE_SETTLE_MS = 1_200;

/** Soloyard: the preview half of the editor's preview / source toggle for our file kinds. */
export function SoloyardFilePreview({
  kind,
  path,
  cwd,
  text,
  active,
  onOpenFile,
}: {
  kind: PreviewKind;
  path: string;
  cwd: string;
  text: string;
  active: boolean;
  onOpenFile?: (path: string) => void;
}) {
  switch (kind) {
    case "csv":
    case "tsv":
      return (
        <FilePreviewSearch active={active} contentVersion={text}>
          <CsvPreview text={text} delimiter={kind === "csv" ? "," : "\t"} />
        </FilePreviewSearch>
      );
    case "jsonl":
      return (
        <FilePreviewSearch active={active} contentVersion={text}>
          <JsonlPreview text={text} />
        </FilePreviewSearch>
      );
    case "mermaid":
      return (
        <MarkdownDocumentPreview
          text={`\`\`\`\`mermaid\n${text}\n\`\`\`\``}
          metadataLabel=""
          cwd={cwd}
          onOpenFile={onOpenFile}
        />
      );
    case "html":
      return <HtmlPreview path={path} cwd={cwd} text={text} active={active} />;
  }
}

/**
 * The page runs in a sandboxed frame served from disk (`soloyard_preview.rs`),
 * so it reloads once an edit has had time to autosave, or on demand.
 */
function HtmlPreview({
  path,
  cwd,
  text,
  active,
}: {
  path: string;
  cwd: string;
  text: string;
  active: boolean;
}) {
  const { t } = useTranslation("soloyard");
  const [version, setVersion] = useState(0);
  const loaded = useRef(text);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!active || text === loaded.current) return;
    const timer = window.setTimeout(() => {
      loaded.current = text;
      reload();
    }, SAVE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, text, reload]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
        <BandButton onClick={reload}>
          <RotateCcw className="size-3" strokeWidth={1.75} />
          {t("filePreview.reload")}
        </BandButton>
        <BandButton
          onClick={() => void openPathWithDefaultApp(path).catch(() => {})}
        >
          <ExternalLink className="size-3" strokeWidth={1.75} />
          {t("filePreview.openInBrowser")}
        </BandButton>
      </div>
      <iframe
        key={version}
        src={frameUrl(path, cwd)}
        sandbox="allow-scripts"
        title={t("filePreview.frameTitle", { name: basename(path) })}
        // Pages assume a browser's white canvas.
        className="min-h-0 flex-1 border-0 border-t border-stroke bg-white"
      />
    </div>
  );
}

/** Soloyard: what the editor shows for a file it can't read as text. */
export function UnreadableFile({
  path,
  cwd,
  message,
}: {
  path: string;
  cwd: string;
  message: string;
}) {
  const { t } = useTranslation("soloyard");
  return (
    <FileCard
      path={path}
      cwd={cwd}
      title={basename(path)}
      detail={
        message.startsWith("File is too large")
          ? message
          : t("filePreview.noPreview")
      }
      icon={
        <div className="mx-auto mb-3 flex justify-center">
          <FileTypeIcon name={basename(path)} isDir={false} size={28} />
        </div>
      }
      offerOpen
    />
  );
}

function JsonlPreview({ text }: { text: string }) {
  const { t } = useTranslation("soloyard");
  const { records, more } = useMemo(
    () => splitRecords(text, RECORD_LIMIT),
    [text],
  );
  const rows = formatInteger(records.length);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center px-4 text-[11.5px] text-content/45">
        {records.length === 0
          ? t("csv.empty")
          : t(more ? "jsonl.firstRecords" : "jsonl.records", {
              count: records.length,
              rows,
            })}
      </div>
      {records.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 select-text">
          <div className="overflow-clip rounded-[10px] border border-content/10 font-mono text-[12px] text-content/85">
            {records.map((record) => (
              <JsonRecord
                key={record.line}
                line={record.line}
                text={record.text}
              />
            ))}
          </div>
          {more ? (
            <p className="pt-3 text-center text-[11.5px] text-content/45">
              {t("jsonl.truncated", { count: RECORD_LIMIT, rows })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One line, collapsed to its start; opening it parses and pretty-prints it. */
function JsonRecord({ line, text }: { line: number; text: string }) {
  const { t } = useTranslation("soloyard");
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => {
    if (!open) return null;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return null;
    }
  }, [open, text]);

  return (
    <details
      className="group border-b border-content/5 last:border-b-0 open:bg-content/3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-default list-none items-center gap-2 px-3 py-1.5 hover:bg-content/4 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3 shrink-0 text-content/35 transition-transform group-open:rotate-90"
          strokeWidth={2}
        />
        <span className="w-9 shrink-0 text-right text-[11px] text-content/30 tabular-nums">
          {line}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <Json text={text.slice(0, 400)} />
        </span>
      </summary>
      {open ? (
        <div className="pr-3 pb-3 pl-[4.25rem]">
          {pretty === null ? (
            <p className="pb-1 font-sans text-[11.5px] text-red-400">
              {t("jsonl.invalid")}
            </p>
          ) : null}
          <pre className="overflow-x-auto leading-5 whitespace-pre-wrap break-all">
            <Json text={pretty ?? text} />
          </pre>
        </div>
      ) : null}
    </details>
  );
}

const TOKEN_CLASS: Record<JsonToken["kind"], string> = {
  key: "text-sky-700 dark:text-sky-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-amber-700 dark:text-amber-300",
  literal: "text-violet-700 dark:text-violet-300",
  plain: "text-content/55",
};

function Json({ text }: { text: string }) {
  return jsonTokens(text).map((token, index) => (
    <span key={index} className={TOKEN_CLASS[token.kind]}>
      {token.text}
    </span>
  ));
}

function BandButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-content/55 hover:bg-content/10 hover:text-content"
    >
      {children}
    </button>
  );
}
