#!/bin/sh
# Soloyard 手机端：打一个给手机装的 APK。每次自动把版本号末位加一（安卓安装器才认得出是新版本），
# 也可以指定版本：sh scripts/release-apk.sh 0.3.0
# 产物复制到 ~/Downloads/Soloyard-mobile-<版本>.apk。先清掉 Android 的构建目录，免得增量打包把 APK 越撑越大。
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -e '
  const fs = require("fs");
  const file = "src-tauri/tauri.conf.json";
  const conf = JSON.parse(fs.readFileSync(file, "utf8"));
  const [major, minor, patch] = conf.version.split(".").map(Number);
  conf.version = process.argv[1] || `${major}.${minor}.${patch + 1}`;
  fs.writeFileSync(file, JSON.stringify(conf, null, 2) + "\n");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = conf.version;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log(conf.version);
' "$1")
(cd src-tauri/gen/android && ./gradlew clean -q)
sh scripts/android.sh build --debug --apk --split-per-abi --target aarch64
OUT="$HOME/Downloads/Soloyard-mobile-$VERSION.apk"
cp src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk "$OUT"
echo "版本 $VERSION → $OUT"
