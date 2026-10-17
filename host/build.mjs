import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { importMetaGlob } from "../scripts/soloyard-esbuild-glob.mjs"; // Soloyard

await build({
  entryPoints: ["host/cli.ts"],
  outfile: "build/host/monocode-host.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  loader: { ".ps1": "text" },
  define: { "import.meta.hot": "undefined" },
  sourcemap: true,
  plugins: [importMetaGlob], // Soloyard：src/i18n 的 import.meta.glob
});
await copyFile("host/provider-guard.mjs", "build/host/provider-guard.mjs");
