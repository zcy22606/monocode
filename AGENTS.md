# AGENTS.md — IndieDesk（MonoCode fork）

给在这个仓库里干活的 coding agent（Claude Code / Codex）看。和用户沟通一律用中文。

## 这是什么

- **IndieDesk**（工作名）：独立开发者的「项目流水线」桌面应用。在 MonoCode 之上加一层项目管理：想法 → 立项 → 功能全景 → 迭代 → issue → 开 agent 会话干活 → 验收。agent 执行、编排、worktree 直接用 MonoCode 现成的。
- 上游：`hardbeat920/monocode`（MIT，单人维护，更新很快）。本仓库是 fork `zcy22606/monocode`，开发在 `indie-desk` 分支；`upstream` remote 已配好。
- 应用标识是 `dev.indiedesk.desktop`。用户本机装着官方 MonoCode（`com.monocode.desktop`），**绝不能让本应用读写它的数据目录**。
- 相关资料（只读参考）：
  - 设计与决策：`~/Playground/proof/prototypes/indie-desk-v0/`（`docs/`、`research/decisions.json`，D-19 = 基于 MonoCode fork）
  - 旧的 Electron 原型：`~/Playground/indie-desk`（数据层 core / MCP / 技能的来源）。**不要照搬它的界面**，每个功能的交互和 UI 先和用户讨论定了再做。

## 和上游共处的规矩（最重要）

上游每天十几次提交，热点在 `src/app/App.tsx`、`src/app/shell/Sidebar.tsx`、`src/features/sessions`、harness 适配层。为了以后同步上游少冲突：

1. 我们的代码放新文件：前端 `src/features/indie/`，后端 `src-tauri/src/<新模块>.rs`。
2. 上游文件只加「挂载」用的几行，旁边注释 `IndieDesk`；不重构、不顺手改上游代码。
3. 上游测试因为我们加东西而失败（比如写死了分页数量），只改期望值，并注明原因。
4. 不加新依赖，除非先问用户。

## 已有的 IndieDesk 改动

- `src-tauri/src/history_import.rs`：列项目会话时，把该目录下 Claude Code / Codex 的终端历史会话导进侧栏（只读转录文件，按 mtime 增量）。
- 侧栏分页改成等宽图标，最多 5 个，多的进下拉；新增 `Project` 分页（`src/features/indie/`），竖排视图，点一项开顶层标签，内容目前是占位。

## 常用命令

```bash
npm install
npm run tauri dev                                   # 开发版；前端热更新，改 Rust 要重启
npx tsc --noEmit -p tsconfig.json                   # 前端类型检查
npx vitest run                                      # 前端测试
cargo test --manifest-path src-tauri/Cargo.toml     # Rust 测试（用 debug；上游有测试在 --release 下编译不过）
```

改完至少跑类型检查和相关测试，结果如实告诉用户。

## 界面约定

- 界面文字目前是英文，国际化还没做；做完之后，新加的界面文字一律走 i18n，不写死。
- 样式跟 MonoCode：`bg-background-base`、`text-content/60`、`border-stroke`、`bg-selection`、`hover:bg-content/10`；图标用 `src/shared/ui/icons.tsx` 里的 Hugeicons 封装；通用组件在 `src/shared/ui/`。

## 不要做的

- 用户没说就不要 commit，更不要 push。
- 不要读取或输出任何凭证（`~/.codex/auth.json`、token、`~/.gitconfig` 里的密钥等）。
- 不要改用户本机的 agent 配置（`~/.claude`、`~/.codex`），除非用户在应用里明确操作或明确要求。
