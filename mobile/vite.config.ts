import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const tauriHost = process.env.TAURI_DEV_HOST;
// app 里显示版本和构建时间，装到手机上一眼对得上是哪一版
const appVersion = (JSON.parse(readFileSync(fileURLToPath(new URL("src-tauri/tauri.conf.json", import.meta.url)), "utf8")) as { version: string }).version;

/**
 * 在电脑浏览器里调界面用：开发服务器替网页去调本机的试用主机，和手机上原生层的 `host_rpc` 收发一样的东西。
 * 默认直连 monocode-host；走网关时设 SOLOYARD_DEV_HOST_URL（网关地址）和 SOLOYARD_DEV_DEVICE（网关上的设备凭据）。
 * 只在 `vite` 开发时存在。
 */
function devHost(): Plugin {
  const hostUrl = process.env.SOLOYARD_DEV_HOST_URL ?? "http://127.0.0.1:3774";
  const devicePath = process.env.SOLOYARD_DEV_DEVICE ?? `${homedir()}/.soloyard-host-trial/android-dev-device.json`;
  const device = () => {
    try {
      return JSON.parse(readFileSync(devicePath, "utf8"));
    } catch {
      return null;
    }
  };
  // 网关的设备凭据里没有主机的 environmentId：像手机配对时一样，先问一次主机是谁
  let environmentId: string | undefined;
  return {
    name: "soloyard-dev-host",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__host", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const { method, params } = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        const dev = device();
        res.setHeader("content-type", "application/json");
        const fail = (kind: string, message: string) => {
          res.statusCode = 502;
          res.end(JSON.stringify({ kind, message }));
        };
        if (!dev) return fail("unpaired", "No dev device in ~/.soloyard-host-trial");
        const post = (m: string, p: unknown, env?: string) =>
          fetch(`${hostUrl}/rpc`, {
            method: "POST",
            headers: { authorization: `Bearer ${dev.token}`, "content-type": "application/json" },
            body: JSON.stringify({ version: 1, environmentId: env, method: m, params: p }),
          });
        try {
          environmentId ??= dev.environmentId ?? (await (await post("environment.describe", {})).json()).result?.environmentId;
          const response = await post(method, params, environmentId);
          const body = await response.json();
          if (body.error) return fail(response.status === 401 ? "auth" : "host", body.error);
          res.end(JSON.stringify(body.result ?? null));
        } catch (error) {
          fail("network", String(error));
        }
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss(), devHost()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: tauriHost || false,
    hmr: tauriHost ? { protocol: "ws", host: tauriHost, port: 1431 } : undefined,
    // 复用仓库里的协议类型和会话类型
    fs: { allow: [".."] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  define: { __APP_VERSION__: JSON.stringify(appVersion), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
