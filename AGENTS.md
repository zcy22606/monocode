# AGENTS.md — Soloyard

给在这个仓库里干活的 coding agent（Claude Code / Codex）看。和用户沟通一律用中文。

## 这是什么

- **Soloyard**：独立开发者的桌面工作台——一个人带着 AI agent，从想法做到上线。用户做决策和减法，agent 干活。主线是项目管理：想法 → 立项 → 功能全景 → 迭代 → issue → 开 agent 会话干活 → 验收。agent 执行、编排、worktree 用底座现成的能力。
- **底座**：本项目基于开源项目 MonoCode（`hardbeat920/monocode`，MIT，单人维护，更新很快）fork 开发。fork 在 `zcy22606/monocode`，开发分支 `indie-desk`，`upstream` remote 已配好。
- 应用标识 `dev.indiedesk.desktop`（数据目录跟着它；改成 Soloyard 命名留到改名任务 SOL-6，必须连同数据库和 WebKit 存储一起迁移，**不要单独改标识**，否则会话、worktree 记录、项目列表都会"消失"）。用户本机装着官方 MonoCode（`com.monocode.desktop`），**绝不能读写它的数据目录**。
- **重启开发版会中断里面正在跑的 agent 会话**。要重启（改了 Rust、改了数据层）先问用户有没有会话在跑。
- 相关资料（只读参考）：
  - 设计与决策：`~/Playground/proof/prototypes/indie-desk-v0/`（`docs/`、`research/decisions.json`；D-19 = 基于 MonoCode fork）
  - 旧的 Electron 原型：`~/Playground/indie-desk`（数据层 core / MCP / 技能的来源）。**不要照搬它的界面**，每个功能的交互和 UI 先和用户讨论定了再做。

## 命名规则

- **新写的代码一律用 Soloyard 命名**：前端目录 `src/features/soloyard/`，Rust 模块 `src-tauri/src/soloyard_*.rs`（已有的 `history_import.rs` 例外），数据库表 `soloyard_` 前缀，localStorage 键 / 事件名 `soloyard.` / `soloyard:` 前缀，注释标记 `Soloyard`。
- 上游原有的 `monocode` 命名（键名、事件名、类名、库文件名 `monocode.db`）**暂时不改**，统一放到后面的改名任务里。

## 和上游共处的规矩（最重要）

上游每天十几次提交，热点在 `src/app/App.tsx`、`src/app/shell/Sidebar.tsx`、`src/features/sessions`、harness 适配层。为了合并上游少冲突：

1. 我们的代码放新文件，上游文件只加「挂载」用的几行，旁边注释 `Soloyard`；不重构、不顺手改上游代码。
2. 上游测试因为我们加东西而失败（比如写死了分页数量），只改期望值并注明原因。
3. 不加新依赖，除非先问用户。（已同意：`i18next`、`react-i18next`）
4. 数据存在应用自己的库 `monocode.db`：我们的表都用 `soloyard_` 前缀，用自己的迁移记录，不碰上游的 `schema_migrations` 和上游表结构。

**定期审查上游**：隔一段时间看一次 `upstream/main` 的新提交，挑有价值的修复和功能合并进来（`git fetch upstream` 后在新分支上合并、跑测试，再交给用户确认）。

## 低优先级任务（记着，先不做）

1. **去掉产品层面的 MonoCode 痕迹**：等国际化 PR 合进本分支后单独开任务。范围：应用名、窗口标题、菜单、界面文字、链接（usemono.dev、GitHub star 提示等）、图标、进程名、数据目录、库文件名、环境变量、命令行名。`LICENSE` 里 MonoCode 原作者的版权声明按 MIT 必须保留（可追加我们的版权）。代码内部命名是否一起改，到时候再定。
2. **和上游彻底切割**：在合适的时候停止合并 MonoCode 的新提交，走独立路线；切割时再统一改掉代码内部的 monocode 命名。

## 已有的 Soloyard 改动

- `src-tauri/src/history_import.rs`：列项目会话时，把该目录下 Claude Code / Codex 的终端历史会话导进侧栏（只读转录文件，按 mtime 增量）。
- 侧栏分页改成等宽图标，最多 5 个，多的进下拉；新增 `Project` 分页（`src/features/soloyard/`），竖排视图，点一项开顶层标签。
- **数据**：`soloyard/core/`（Node，零依赖，`node:sqlite`）是唯一的数据实现，表在 `monocode.db` 里、`soloyard_` 前缀、迁移记在 `soloyard_migrations`。
  - 界面经 `src-tauri/src/soloyard_bridge.rs` 拉起常驻的 `soloyard/core/src/sidecar.ts`，前端用 `src/features/soloyard/data/api.ts`（`useSoloyard` / `mutateSoloyard`），我们的数据变了会收到 `soloyard:changed` 自动刷新。
  - agent 经 `soloyard/mcp/server.ts`（零依赖 stdio MCP）读写同一个库；`soloyard/core/src/import-legacy.ts` 是原型库的一次性导入。
- **Issues**：列表 / 看板、视图配置和筛选（`model/issueView.ts` 的字段注册表——加新维度只注册一个字段）、行内新建、详情标签、Start work（开新会话，开工提示词填进输入框，模型 / 工作区由用户选）、验收（Accept / Send back）。
- **会话关联**（SOL-5）：输入框顶栏分支后面的关联按钮（`ui/session/SessionLinks.tsx`），可挂文件夹、文件、issue、文档、功能、决策，存在 `soloyard_session_links`。按需注入：关联对象进输入框的 @ 候选（`model/sessionMentions.ts`，写法 `@link/SOL-5`），发送时只把 @ 到的内容附成 `<soloyard_context>`（`model/sessionContext.ts`）；关联的文件夹自动给 Claude 加 `--add-dir`、给 Codex 加 `writableRoots`。上游挂载：`Composer.tsx`（顶栏插槽 + @ 候选）、`SessionPane.tsx`、`App.tsx`、`claude.ts`、`codex.ts`。
- 请底座做事（开会话、切会话、发消息、开标签）一律用窗口事件（`model/appActions.ts`、`model/projectViews.ts`），App.tsx 里各只有一个监听。
- 项目自己的待办就在应用里：`~/Playground/monocode` 对应项目 **Soloyard（SOL）**，开工前先看 SOL 的 issue。
- 多语言：`src/i18n/` + `src-tauri/src/i18n.rs`，上游界面文字也改成了 i18n（这是用户明确决定的，同步上游时冲突会比较多，按「上游加了新文字就补 key」来合）。我们的界面用命名空间 `soloyard`。

## 常用命令

```bash
npm install
npm run tauri dev                                   # 开发版；前端热更新，改 Rust 要重启
npx tsc --noEmit -p tsconfig.json                   # 前端类型检查
npx vitest run                                      # 前端测试
cargo test --manifest-path src-tauri/Cargo.toml     # Rust 测试（用 debug；上游有测试在 --release 下编译不过）
node --test soloyard/core/test/*.ts soloyard/mcp/test/*.ts   # 数据层 + MCP 测试
```

改完至少跑类型检查和相关测试，结果如实告诉用户。

## 界面约定

- 界面文字一律走 i18n，不写死。规范见下面「多语言」。
- 样式跟底座一致：`bg-background-base`、`text-content/60`、`border-stroke`、`bg-selection`、`hover:bg-content/10`；图标用 `src/shared/ui/icons.tsx` 里的 Hugeicons 封装；通用组件在 `src/shared/ui/`。

## 多语言（i18n）

用 i18next + react-i18next，目前支持英文（默认）和简体中文，设置里还可以选「跟随系统」。

- 代码在 `src/i18n/`：`index.ts`（初始化、语言偏好）、`locales/<en|zh-CN>/<命名空间>.json`、`i18next.d.ts`（新增命名空间要在这里加一行）。
- 一个功能目录一个命名空间：`src/features/<x>` 用 `<x>`（短横线改成驼峰，比如 `sourceControl`；我们的 `src/features/soloyard` 用 `soloyard`），`src/app/shell` 用 `shell`，`src/app` 其余部分用 `app`，`src/shared` 用 `shared`。
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
