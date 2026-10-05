#!/bin/sh
# Soloyard：构建正式版并装到 /Applications（日常用的那份，数据目录 dev.indiedesk.desktop）。
# 开发版照常 `npm run tauri dev`（Soloyard Dev，数据目录 dev.indiedesk.desktop.dev），两边互不影响。
# 正式版运行时只用打包进应用的数据层和 MCP 脚本，仓库里改着的代码碰不到它。
set -eu
cd "$(dirname "$0")/.."
npm run tauri build -- --config src-tauri/tauri.prod.conf.json
APP=target/release/bundle/macos/Soloyard.app
# ps 的 comm 列：pgrep -f 读不到正式版的命令行，会漏判
if ps -axo comm | grep -q "^/Applications/Soloyard.app/Contents/MacOS/"; then
  echo "正式版正在运行：退出它（会中断里面正在跑的会话）后再运行一次本脚本，或手动替换："
  echo "  rm -rf /Applications/Soloyard.app && cp -R \"$PWD/$APP\" /Applications/"
  exit 1
fi
rm -rf /Applications/Soloyard.app
cp -R "$APP" /Applications/
echo "已安装 /Applications/Soloyard.app"
