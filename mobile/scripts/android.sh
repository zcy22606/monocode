#!/bin/sh
# Soloyard 手机端：带上 Android 构建要的环境变量再调 `tauri android …`。
#   npm run android -- init
#   npm run android -- dev                       # 模拟器或 USB 连着的手机
#   npm run android -- build --debug --apk --target aarch64
set -e
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* | sort -V | tail -1)}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd "$(dirname "$0")/.."
exec npx tauri android "$@"
