#!/bin/sh
# 按 app 当前的进程转发 WebView 调试端口，再执行 webview.mjs（见那个文件的说明）
PID=$(adb shell pidof dev.soloyard.mobile | tr -d '\r')
adb forward --remove-all >/dev/null
adb forward tcp:9333 localabstract:webview_devtools_remote_$PID >/dev/null
exec node "$(dirname "$0")/webview.mjs" "$@"
