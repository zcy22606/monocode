import { listDir, openPathWithDefaultApp, statFiles } from "../../../platform/tauri/fs";
import { resolveWorkspacePath } from "../../../shared/lib/paths";

// Soloyard: inline code paths the upstream check misses — folders (`output/`, `~/Playground/x`)
// and file names outside ASCII (`指南.md`). Undefined leaves the decision to upstream.
// ponytail: a folder needs a trailing slash or an absolute / home path, so `mc/abc` branch names stay text.
export function inlinePath(value: string): { name: string; isDir: boolean } | undefined {
  const text = value.trim();
  if (!text || text === "/" || text.length > 240 || /\s/.test(text) || text.includes("://"))
    return undefined;
  const bare = text.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  const name = bare.split("/").filter(Boolean).pop() ?? "";
  if (bare.endsWith("/")) return name ? { name, isDir: true } : undefined;
  if (/\.[A-Za-z][A-Za-z0-9+-]{0,11}$/.test(name)) return { name, isDir: false };
  return bare.startsWith("~/") || FS_ROOTS.test(bare) ? { name, isDir: true } : undefined;
}

// An extensionless absolute path is a folder only under a real filesystem root; `/mcp`, `/chat/open` are URL routes.
const FS_ROOTS = /^\/(Users|home|tmp|private|var|opt|etc|usr|Volumes|Applications|Library|System|mnt|srv|root)(\/|$)/;

// Soloyard: agents name Claude Code's memory files (`MEMORY.md`, `state-….md`) without their folder,
// which is ~/.claude/projects/<cwd, every non-alphanumeric as ->/memory/, not the project.
export function memoryFile(name: string, cwd: string): string | undefined {
  if (!name || /[/\\]/.test(name)) return undefined;
  const slug = cwd.replace(/[/\\]+$/, "").replace(/[^A-Za-z0-9]/g, "-");
  return resolveWorkspacePath(`~/.claude/projects/${slug}/memory/${name}`, cwd);
}

/**
 * Soloyard: last resort of `resolveOpenablePath`, once no project file matches. A bare name that
 * isn't under the cwd either but is a Claude memory file opens that file instead of an error page.
 */
export async function claudeMemoryFile(name: string, cwd: string, direct: string): Promise<string | undefined> {
  const memory = memoryFile(name, cwd);
  if (!memory) return undefined;
  try {
    const [here, there] = await statFiles([direct, memory]);
    return here.mtimeMs == null && there.mtimeMs != null ? memory : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Soloyard: whether a link names a real file. `resolveOpenablePath` then opens it as named; otherwise a
 * file outside the project or gitignored (`~/x/index.html`, `dist/index.html`) is "suffix-matched" to the
 * project's own `index.html`.
 */
export async function isFileOnDisk(path: string): Promise<boolean> {
  try {
    const [stat] = await statFiles([path]);
    return stat?.mtimeMs != null;
  } catch {
    return false;
  }
}

// Soloyard: agents name a file bare (`MNEMONICS.txt`) after naming it, or its folder, in full earlier
// (`~/.bittensor/wallets/company-miner/`). Absolute and home paths in rendered agent text, newest last.
// ponytail: rendering order stands in for conversation order, app-wide; per-session lists if names clash.
const mentioned: string[] = [];
const MENTION_LIMIT = 300;
const PATH_IN_TEXT = /(?<![\w:./~-])~?\/[^\s`'"<>()[\]{}，。；：！？、|*]+/gu;

export function rememberMentionedPaths(text: string, cwd?: string): void {
  for (const [token] of text.matchAll(PATH_IN_TEXT)) {
    const raw = token.replace(/[.,;:!?]+$/, "");
    if (!raw.startsWith("~/") && raw.split("/").length < 3) continue;
    const path = resolveWorkspacePath(raw, cwd)?.replace(/\/+$/, "");
    if (!path) continue;
    const seen = mentioned.indexOf(path);
    if (seen >= 0) mentioned.splice(seen, 1);
    mentioned.push(path);
  }
  if (mentioned.length > MENTION_LIMIT) mentioned.splice(0, mentioned.length - MENTION_LIMIT);
}

/** A file of this bare name that was mentioned in full, or sits in a mentioned folder; newest first. */
export async function mentionedFile(name: string): Promise<string | undefined> {
  if (!name || /[/\\]/.test(name)) return undefined;
  const candidates = [
    ...new Set([...mentioned].reverse().map((path) => (path.endsWith(`/${name}`) ? path : `${path}/${name}`))),
  ].slice(0, 100);
  if (candidates.length === 0) return undefined;
  try {
    const found = new Set((await statFiles(candidates)).filter((stat) => stat.mtimeMs != null).map((stat) => stat.path));
    return candidates.find((path) => found.has(path));
  } catch {
    return undefined;
  }
}

/**
 * Soloyard: `inlinePath` guesses folder for an extensionless path, but `~/.ssh/id_ed25519`, `…/coldkey`
 * and `Makefile` are files, so the disk decides. Unknown stays a folder, as guessed.
 */
export async function isFolder(path: string): Promise<boolean> {
  const trimmed = path.replace(/[/\\]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = trimmed.slice(slash + 1);
  try {
    const entries = await listDir(trimmed.slice(0, slash) || "/");
    return entries.find((entry) => entry.name === name)?.isDir ?? true;
  } catch {
    return true;
  }
}

/** Soloyard: a folder link opens in Finder, or in the app when it turns out to be a file. */
export async function openPathLink(path: string, onOpenFile?: (path: string) => void): Promise<void> {
  if (onOpenFile && !(await isFolder(path))) onOpenFile(path);
  else await openPathWithDefaultApp(path);
}
