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
