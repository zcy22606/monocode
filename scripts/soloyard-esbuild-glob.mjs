// Soloyard：esbuild 不认识 Vite 的 import.meta.glob（src/i18n 用它加载翻译）。
// 打包主机（host/build.mjs）时把 import.meta.glob("./dir/*.json", { eager: true })
// 展开成静态 import，否则主机一启动就报 `glob is not a function`。
// ponytail: 只支持 eager + 单层 `*` 的写法，i18n 只用到这种。
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const GLOB = /import\.meta\.glob\(\s*["']([^"']+)["']\s*,\s*\{\s*eager:\s*true\s*\}\s*\)/g;

export const importMetaGlob = {
  name: "soloyard-import-meta-glob",
  setup(build) {
    build.onLoad({ filter: /src[\\/]i18n[\\/]index\.ts$/ }, async ({ path }) => {
      let source = await readFile(path, "utf8");
      const imports = [];
      for (const [call, pattern] of [...source.matchAll(GLOB)]) {
        const dir = dirname(pattern);
        const [prefix, suffix] = pattern.slice(dir.length + 1).split("*");
        const files = (await readdir(join(dirname(path), dir)))
          .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
          .sort();
        const entries = files.map((f) => {
          const name = `__glob${imports.length}`;
          imports.push(`import * as ${name} from ${JSON.stringify(`${dir}/${f}`)};`);
          return `${JSON.stringify(`${dir}/${f}`)}: ${name}`;
        });
        source = source.replace(call, `{ ${entries.join(", ")} }`);
      }
      return { contents: `${imports.join("\n")}\n${source}`, loader: "ts" };
    });
  },
};
