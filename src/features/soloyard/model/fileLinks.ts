// Soloyard: inline code that names a folder (`output/`, `~/Playground/x`) becomes a link too.
// ponytail: only a trailing slash or an absolute / home path counts, so `mc/abc` branch names stay text.
export function inlineFolderPath(value: string): string | undefined {
  const text = value.trim();
  if (!text || text === "/" || text.length > 240 || /\s/.test(text) || text.includes("://"))
    return undefined;
  return text.endsWith("/") || text.startsWith("/") || text.startsWith("~/")
    ? text
    : undefined;
}
