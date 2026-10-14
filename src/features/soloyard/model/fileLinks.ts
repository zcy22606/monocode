import { statFiles } from "../../../platform/tauri/fs";
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
  return bare.startsWith("/") || bare.startsWith("~/") ? { name, isDir: true } : undefined;
}

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
