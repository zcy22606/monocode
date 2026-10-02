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
4. 不加新依赖，除非先问用户。（已同意：`i18next`、`react-i18next`）

## 已有的 IndieDesk 改动

- `src-tauri/src/history_import.rs`：列项目会话时，把该目录下 Claude Code / Codex 的终端历史会话导进侧栏（只读转录文件，按 mtime 增量）。
- 侧栏分页改成等宽图标，最多 5 个，多的进下拉；新增 `Project` 分页（`src/features/indie/`），竖排视图，点一项开顶层标签，内容目前是占位。
- 多语言：`src/i18n/` + `src-tauri/src/i18n.rs`，上游界面文字也改成了 i18n（这是用户明确决定的，同步上游时冲突会比较多，按「上游加了新文字就补 key」来合）。

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

- 界面文字一律走 i18n，不写死。规范见下面「多语言」。
- 样式跟 MonoCode：`bg-background-base`、`text-content/60`、`border-stroke`、`bg-selection`、`hover:bg-content/10`；图标用 `src/shared/ui/icons.tsx` 里的 Hugeicons 封装；通用组件在 `src/shared/ui/`。

## 多语言（i18n）

用 i18next + react-i18next，目前支持英文（默认）和简体中文，设置里还可以选「跟随系统」。

- 代码在 `src/i18n/`：`index.ts`（初始化、语言偏好）、`locales/<en|zh-CN>/<命名空间>.json`、`i18next.d.ts`（新增命名空间要在这里加一行）。
- 一个功能目录一个命名空间：`src/features/<x>` 用 `<x>`（短横线改成驼峰，比如 `sourceControl`），`src/app/shell` 用 `shell`，`src/app` 其余部分用 `app`，`src/shared` 用 `shared`。
- 组件里用 `import { useTranslation } from "<相对路径>/i18n"`（不要直接从 `react-i18next` 引，这样能保证 i18n 已经初始化）。**凡是显示文字的组件都要调 `useTranslation()`**，切换语言时才会重新渲染。
- 模块级常量（选项列表、表头、菜单项……）不要存翻译好的文字，存 key 或在渲染时调函数翻译；非组件代码可以用 `src/i18n` 导出的 `t`，但只能在渲染时调用。
- key 用语义化的嵌套形式（`general.sounds.label`）。英文翻译必须和原来的文字**一字不差**，这样上游测试不用改。
- 复数：英文写 `xxx_one` / `xxx_other`，中文只写 `xxx_other`，调用时传 `{ count }`。插值用 `{{name}}`；文字中间夹着 JSX 元素的用 `<Trans>`。
- 不翻译：品牌和产品名（MonoCode、Claude、Codex、GitHub……）、模型名、代码标识符、存储或匹配用的值（快捷键命令 id、设置值、事件名）、`console`/日志、后端传过来的报错原文、测试 id。
- 中文写法：中文和英文、数字之间加空格；用全角标点；省略号用「…」。常用译法：session 会话、project 项目、worktree 工作树、agent 保留 Agent、inbox 收件箱、pane 窗格、tab 标签页、sidebar 侧栏、terminal 终端、commit 提交、branch 分支、diff 差异、pull request / PR 保留、issue 保留、MCP 保留、model 模型、provider 提供方、prompt 提示词、skill 技能、automation 自动化、notes 笔记、settings 设置、keybinding/shortcut 快捷键、composer 输入框、thread 对话、checkpoint 检查点、archive 归档、reminder 提醒、workspace 工作区、changes 更改、stage 暂存、quick composer 快速输入、harness 保留英文或「CLI」看语境。
- `src/i18n/locales.test.ts` 会检查中文有没有漏 key。
- Rust 端的原生文字（菜单、Dock、托盘、通知按钮）在 `src-tauri/src/i18n.rs`，用英文原文当 key：`tr("Settings…")`。

## 不要做的

- 用户没说就不要 commit，更不要 push。
- 不要读取或输出任何凭证（`~/.codex/auth.json`、token、`~/.gitconfig` 里的密钥等）。
- 不要改用户本机的 agent 配置（`~/.claude`、`~/.codex`），除非用户在应用里明确操作或明确要求。
