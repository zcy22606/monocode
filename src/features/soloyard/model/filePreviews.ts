// Soloyard: which files get a preview, and where the preview frames load them from.
import { REMOTE_PATH_PREFIX } from "../../../platform/tauri/fs";

/** Files that open in the editor with a preview / source toggle. */
export type PreviewKind = "csv" | "tsv" | "jsonl" | "mermaid" | "html";

const KINDS: Record<string, PreviewKind> = {
  csv: "csv",
  tsv: "tsv",
  jsonl: "jsonl",
  ndjson: "jsonl",
  mmd: "mermaid",
  mermaid: "mermaid",
  html: "html",
  htm: "html",
};

function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

export function previewKindForPath(path: string): PreviewKind | null {
  const kind = KINDS[extensionOf(path)] ?? null;
  // The HTML frame reads local disk, which a connected machine's file isn't on.
  return kind === "html" && path.startsWith(REMOTE_PATH_PREFIX) ? null : kind;
}

export function isPdfPath(path: string): boolean {
  return extensionOf(path) === "pdf" && !path.startsWith(REMOTE_PATH_PREFIX);
}

/**
 * `<base64url root>/<encoded path>` for the `soloyardpreview` scheme. The root
 * is the project when the file is in it, else the file's folder; the scheme
 * serves nothing outside it, and the page's relative links resolve inside it.
 */
export function previewUrlPath(path: string, cwd: string): string {
  const inProject = cwd && path.startsWith(`${cwd}/`);
  const root = inProject
    ? cwd
    : path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  const token = btoa(String.fromCharCode(...new TextEncoder().encode(root)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const rest = path
    .slice(root.length + 1)
    .split(/[\\/]/)
    .map(encodeURIComponent)
    .join("/");
  return `${token}/${rest}`;
}

/** The editor's read errors for files it can't show as text (`fs.rs`). */
export function isUnreadableTextError(message: string): boolean {
  return /^(Binary files cannot be edited|File is not valid UTF-8|File is too large to edit)/.test(
    message,
  );
}
