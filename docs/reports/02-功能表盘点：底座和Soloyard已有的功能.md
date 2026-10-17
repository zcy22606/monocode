# 功能表盘点：底座和 Soloyard 已有的功能

- 日期：2026-10-17
- 状态：草稿
- 作者：claude-code
- 关联：SOL-21、SOL-41、SOL-15


## 为什么做这次盘点

功能表（迭代页）是立项时按竞品并集排的，不知道底座 MonoCode 已经带了哪些功能，也没跟上 Soloyard 这几周做完的东西，所以 v1.0、v1.1、v2.0 里有不少其实已经有了。2026-10-17 让 4 个只读的子 agent 逐条对照代码（`src/features`、`src/integrations/harness`、`src-tauri/src`、`soloyard/`），每条判「已有 / 部分有 / 没有」并附依据，再人工复核。

- 对照了还没完成的 890 个功能（手机端 F-039～F-048 那 9 个正在做，没算）。
- 子 agent 判「已有」167 条、「部分有」约 190 条；部分有的不动，留在原迭代。
- 复核后确认已有 **159 条**（v0.2 1 条、v1.0 26 条、v1.1 97 条、v2.0 35 条），见下表。

## 复核时拿掉的

| 功能 | 处理 | 理由 |
|---|---|---|
| ONB-017、RUN-100 | 不动 | 在「不做」里，是用户做过的减法 |
| RUN-087 | 不动 | 在「另立项」里；说的是托管云沙箱，不是 SSH 远程 |
| INT-015 | 算部分有 | PR 只关联到会话，没有关联到 issue |
| PROG-002 | 算部分有 | 待处理的会话排在前面，但没有「一键跳到下一个」 |
| KB-028 | 算部分有 | 文件内容搜索只在单个项目里，不能跨项目 |
| TASK-007 | 不动 | 挂着 SOL-15「子任务和依赖的界面」，依赖界面还没有 |
| RUN-133 | **待用户定** | 挂着 SOL-41（崩溃 / 未登录 / 额度用尽的错误态和恢复指引）；底座各有提示，是不是够算完成由用户判断 |

## 确认已有的 159 条

处理方式：挪进 v0.0「已完成」，每条建一个已完成的 issue，描述里写上依据；F-006 直接把已有的 SOL-21 标完成。整批记在一个批次里，可以一键撤销。


### v0.2

| 功能 | 描述 | 依据 | 说明 |
|---|---|---|---|
| F-006 | 测试里 soloyard/data/api.ts 的 listen 抛 unhandled rejection | soloyard/data/api.ts listenForChanges | listen 已加 .catch |

### v1.0

| 功能 | 描述 | 依据 | 说明 |
|---|---|---|---|
| ACCT-003 | 切换主题：浅 / 深 / 跟随系统，自定义主题或主题市场 | settings/model/appearance.ts ThemePreference | 浅色、深色、跟随系统都有 |
| ACCT-005 | 自定义快捷键（改绑、重置、按键反查） | settings.ts KeybindingOverrides | 能改绑、重置、搜索 |
| ACCT-006 | 命令面板 / 动作面板（⌘K）执行几乎所有动作 | files/ui/FilePicker.tsx paletteMode | 命令面板（⇧⌘P，不是 ⌘K） |
| ACCT-018 | 常驻系统托盘 / 菜单栏图标 | mono_chat/menu_bar.rs | macOS 菜单栏图标 |
| BILL-001 | 查看外部 agent 订阅（Claude / Codex）额度与重置时间 | rate_limits.rs、UsageFooter.tsx | 显示额度和重置时间 |
| BILL-026 | 以开源许可免费使用 / 自行 fork | LICENSE（MIT） | 开源许可 |
| CTX-001 | 重启 / 崩溃后自动接续 agent 会话，草稿不丢 | session_store.rs、workspaceSnapshot.ts | 重启后恢复会话和草稿 |
| CTX-006 | 看上下文用量：窗口占用、节奏，变色时建议开新会话 | sessions/ui/ContextMeter.tsx | 上下文占用圆环，满了变色 |
| CTX-036 | 项目和 initiative 有稳定 ID，方便 agent 引用 | 项目 key、SOL-n、D-n | 稳定 ID |
| INT-013 | 一键在外部 IDE 打开工作区 | external_editor.rs | 在外部编辑器打开 |
| PLAN-023 | 先和 agent 聊清想法，再生成正式项目（idea → 立项） | soloyard/ui/brainstorm、core/src/ideas.ts | 头脑风暴后提升为项目 |
| PROG-001 | 每个会话的实时状态指示：侧栏 / 标签上显示工作中 / 等输入 / 完成 / 出错、未读、分支、diff 统计、PR 徽标 | shell/Sidebar.tsx | 会话状态、未读、改动统计、PR 图标 |
| PROG-003 | agent 完成 / 等输入 / 出错时发系统通知，点通知跳到会话 | notifications.rs handle_click | 点通知跳回会话 |
| PROG-004 | 在菜单栏 / Dock 角标看哪些会话在等我 | notifications/model/dockBadge.ts | Dock 角标显示等待数 |
| PROG-030 | 查看 agent 改动 diff：按文件 / 按范围（未暂存 / 本轮 / 分支 / 检查点之间） | SessionChangesDiff、WorkingTreeDiff | 按会话、工作区、分支看 diff |
| RUN-004 | 图形聊天界面驱动 coding agent：用户能在应用里用聊天界面（非纯终端）跟 Claude Code / Codex 等会话交互 | sessions/ui/SessionPane.tsx | 图形聊天界面 |
| RUN-005 | 内嵌终端里跑 agent 原生 CLI：用户能在应用的终端里直接用 agent 的 TUI 并随时进出 | pty.rs、terminal/ui/TerminalView.tsx | 内嵌终端 |
| RUN-007 | 选 agent 开会话：用户能从多家 coding agent CLI 里选一个开新会话 | sessions/ui/ModelPicker.tsx | 多家 CLI 可选 |
| RUN-021 | 在界面内回答 agent 的提问：agent 发问（AskUserQuestion 等）时用户能在界面里选项作答，重启不丢 | sessions/ui/QuestionForm.tsx | 在界面里答问题 |
| RUN-023 | 中断 / 停止 agent：用户能随时打断或停止正在跑的会话 | registry.ts cancelTurn / stopSession | 能停止会话 |
| RUN-093 | 从任务 / issue 直接开 agent 会话：任务描述自动成为 prompt | soloyard/model/startWork.ts | 从 issue 开会话 |
| SESS-007 | 置顶会话 / 项目 / 工作区（部分跨设备同步） | shell/Sidebar.tsx onPinSession | 置顶会话 |
| SESS-008 | 归档会话并能恢复（可连聊天记录一起恢复） | Settings → Archive | 归档后能恢复 |
| TASK-001 | 任务 / issue 追踪 | soloyard/ui/issues/IssuesView.tsx | issue 追踪 |
| TASK-002 | 创建、编辑、指派任务 | IssuesView、IssueDetail | 能新建、编辑 |
| TASK-003 | agent 也能读写和执行任务 | soloyard/mcp/server.ts | agent 能读写 issue |

### v1.1

| 功能 | 描述 | 依据 | 说明 |
|---|---|---|---|
| ACCT-004 | 查看快捷键总表 | settings.ts keybindings | 快捷键总表 |
| ACCT-010 | 多窗口 / 多标签页切换项目 | menu.rs new_window、workspace 标签页 | 多窗口和多标签 |
| ACCT-011 | 分屏 / 拖拽面板布局 | workspace/model/layout.ts split | 分屏，可拖放 |
| ACCT-050 | 界面多语言 / 内容翻译 | src/i18n | 界面多语言 |
| ACCT-056 | 设置通知偏好 | notifications/ui/ProjectNotificationSettings.tsx | 按项目、按类别、可静音 |
| ACCT-081 | agent 修改已有文件前自动备份 | checkpoint.rs、checkpoint/turn.rs | 每轮记快照，可以撤销 |
| BILL-025 | 多个 agent 账号切换 / 不同 agent 用不同订阅 | providers/model/providerAccounts.ts | 多个账号可切换 |
| BILL-074 | 撞到用量上限后，额度重置时自动继续被打断的那一轮 | sessions usageLimit.resumeAtReset | 额度重置后自动继续 |
| CTX-011 | 沿用项目里已有的 agent 配置：自动读 CLAUDE.md / AGENTS.md / skills / MCP / hooks，与 CLI 共用 | 驱动原生 CLI、skills.rs | 和 CLI 共用配置 |
| INT-001 | 连接器 / MCP：用户能图形化添加、测试、授权外部 MCP server 给 agent 用 | settings/ui/McpSettings.tsx、mcp.rs | 粘贴 JSON 添加、看状态、Sign in 授权 |
| INT-012 | 给终端里的外部 agent 装插件，读写本产品的知识 / wiki | SoloyardMcpSettings.tsx、soloyard/mcp/server.ts | 终端里的 Claude Code / Codex 能接 Soloyard MCP |
| KB-001 | 文档 / 页面编辑器：用户能在产品里写 markdown / 富文本项目文档 | notes/ui/NotesView.tsx、soloyard/ui/docs/DocDetail.tsx | 能写 Markdown 笔记和文档 |
| KB-027 | 内置文件浏览器和编辑器 | files/ui/FileTree.tsx、FileEditor.tsx | 文件树加编辑器 |
| KB-029 | 富文件预览：CSV 表格、JSON 折叠、PDF、图片、视频、SQLite | soloyard/model/filePreviews.ts、CsvPreview、PdfPreview、BinaryFileView | 没有 SQLite 预览 |
| KB-055 | 内置代码编辑器（语法高亮、文件标签、minimap） | files/editor（CodeMirror） | 没有 minimap |
| KB-056 | 把会话产物发布成 Artifacts 页面 | artifacts、artifacts.rs | 文档 / 网页两类产物 |
| ONB-007 | 不注册账号直接用 | providers/model/providerAccounts.ts | 只用本机 agent CLI 登录，没有产品账号 |
| ONB-010 | 接入多家 coding agent / 模型 | integrations/harness/providers（11 家） | 多家 agent 适配 |
| ONB-014 | 查看各 agent 账号登录 / 连接状态并刷新 | ProviderSignInDialog.tsx、UsageFooter.tsx | 显示登录 / 用量状态，可刷新 |
| ONB-021 | 管理 agent 安装状态与更新 | providers/model/harnessUpdates.ts、harness_updates.rs | 检测并一键更新 CLI |
| ONB-022 | 指定自定义 agent 可执行文件路径 | providers/model/providerBinaryPaths.ts | 可以自定义 CLI 路径 |
| ONB-025 | 在应用里驱动原生 Claude Code CLI（非 SDK） | claude/claudeProtocol.ts buildClaudeSpawnArgs | 用 stream-json 驱动 claude CLI |
| ONB-028 | 沿用 Claude Code 已有权限配置 | claudeProtocol.ts --setting-sources | 沿用用户的 settings.json |
| ONB-035 | 导入后与源 agent 自动保持同步 | history_import.rs | 终端会话按 mtime 增量同步 |
| ONB-042 | 导入其他工具建的已有 worktree | worktrees.rs、WorktreePicker.tsx | 列出已有的 worktree |
| PLAN-005 | 给项目设里程碑并看进度 | soloyard/core/src/iterations.ts、IterationsView.tsx | 迭代带目标日期和完成进度 |
| PLAN-006 | 用 Release 聚合条目管版本 | soloyard/core/src/iterations.ts | 迭代就是版本 |
| PLAN-024 | 把已有对话升级 / 移入项目 | BrainstormPromoteDialog.tsx | 头脑风暴会话能提升为项目 |
| PLAN-033 | 新项目由 agent 给出初始化建议 | soloyard/core/src/stage.ts、OverviewView.tsx | 由 agent 推进立项 |
| PLAN-034 | 暂停 / 归档 / 删除项目 | ProjectSettingsDialog.tsx、RemoveProjectDialog.tsx | 能搁置、放弃、归档、删除 |
| PLAN-037 | 决策块 / 评审投票并留痕 | soloyard/core/src/decisions.ts、DecisionsView.tsx | 拍板留痕，没有投票 |
| PROG-032 | 看会话改过的文件侧栏 | source-control/ui/SessionChangesDiff.tsx、SessionReview.tsx | 会话改动文件列表 |
| PROG-033 | 在界面里暂存 / 提交 / 推送：按 hunk 选择，AI 起草提交信息 | source-control/ui/GitChangesPanel.tsx | 按 hunk 暂存、AI 写提交信息 |
| PROG-034 | 在 diff 里直接改代码 | files/editor/editorGit.ts | 编辑器里内联显示 diff |
| PROG-035 | 在 diff 行上评论并批量发回 agent 修改 | source-control/model/diffComment.ts | 行评论加进输入框发给 agent |
| PROG-038 | agent 起草 PR 描述并建 PR | GitChangesPanel.tsx generatePrContent | 起草 PR 描述并建 PR |
| PROG-039 | 在应用内看 CI / 检查状态，把失败的检查交给 agent 修 | inbox/ui/InboxPrChecks.tsx、CheckRepairForm.tsx | CI 失败交给 agent 修 |
| PROG-041 | 读回 PR 评审评论并交给 agent 处理（改评论、rebase、修 lint） | inbox/ui/InboxComments.tsx | PR 评论发给 agent |
| PROG-042 | 在应用内合并 PR（squash / merge / rebase） | inbox/ui/InboxView.tsx | merge / squash / rebase |
| PROG-044 | 跨项目 PR 列表 / 收件箱（分配给我 / 团队 / 我发起的，可筛选） | InboxView.tsx、InboxFiltersMenu.tsx | 按项目汇总，能筛分配给我 |
| PROG-057 | 在应用内列出并合并 PR | InboxView.tsx | 列出并合并 PR |
| PROG-058 | 在应用内读回 PR 评审反馈 | InboxComments.tsx | PR 评论 |
| RUN-003 | 协调者 agent 把一句需求拆成多个并行线程（epic）：用户说一句需求，协调者拆线程、派出去并汇总 | orchestration、orchestratorCommand.ts | Orchestrator 模式 |
| RUN-006 | 内嵌通用终端：用户能在会话 / 工作区旁开 shell 终端 | terminal/ui/ProjectTerminalDock.tsx、pty.rs | 内嵌终端 |
| RUN-008 | 选模型与推理强度：用户能为会话 / agent 选模型和 effort | sessions/ui/ModelPicker.tsx | 选模型和 effort |
| RUN-010 | 快速模式：用户能一键切到更快的输出模式 | ModelPicker.tsx fast | Fast 模式 |
| RUN-014 | 计划模式：用户能让 agent 先出计划，审阅批准（或带反馈驳回）后再改代码 | sessions/model/plan.ts、PlanPreview.tsx | 先出计划，再 Build |
| RUN-015 | 选 agent 自主度 / 权限模式：用户能在「每步都问 / 只放行编辑 / 计划 / 全自动」等档位间切换 | sessions/ui/AccessPicker.tsx | 四档权限模式 |
| RUN-022 | 运行中插话引导：agent 工作时用户能发消息纠偏，不必等它结束 | MessageQueue Steer | 跑着时插话转向 |
| RUN-024 | 运行中排队后续提示：agent 忙时用户能先写好下一条，按序自动发出 | sessions/model/messageQueue.ts | 消息排队 |
| RUN-025 | 给 agent 发附件 / 截图 / @ 文件：用户能在输入里引用文件、粘图、拖文件 | attachments.ts、useFileDrop.ts、FileMentionPicker.tsx | 附件和 @ 文件 |
| RUN-026 | 聊天输入里用斜杠命令：用户能在会话输入框用 / 调命令并补全 | skills/ui/SkillPicker.tsx、slashCommands.ts | 斜杠命令和技能 |
| RUN-029 | 侧聊：用户能带着主线上下文临时提问，不污染主线 | sessions/model/btw.ts、BtwSheet.tsx | /btw 侧问 |
| RUN-030 | 引用某条消息追问：用户能选一条历史消息作为上下文继续问 | sessions/model/quoteDraft.ts | 选中文字引用追问 |
| RUN-031 | 开不挂项目 / 不建分支的临时对话：用户能先跟 agent 头脑风暴，不产生 worktree | soloyard/model/brainstorm.ts | 「新想法」开在工作区文件夹 |
| RUN-032 | 并行跑多个 agent 会话：用户能同时开多个会话 / 标签各自运行 | workspace/ui/PaneTree.tsx、LiveAgentsPreview.tsx | 并行多个会话 |
| RUN-033 | 同一工作区挂多个 agent 会话：用户能在同一 worktree 开多个 agent（如一个实现一个评审），共享文件不共享上下文 | source-control/ui/WorktreesPage.tsx | 多个会话共用一个工作树 |
| RUN-034 | worktree 隔离：每个会话 / 任务自动建独立分支 + git worktree | workspace/ui/WorkspacePicker.tsx、worktrees.rs | 新建工作树隔离 |
| RUN-036 | 从已有分支 / PR 开工作区：用户能选源分支或某个 PR 开新会话继续改 | source-control/ui/CreateWorktreeDialog.tsx | 用已有分支建工作树 |
| RUN-037 | 开任务时切换 Git 分支并处理未提交改动：用户能选提交 / stash / 丢弃 | source-control/ui/SwitchBranchDialog.tsx | 切分支（提交 / stash） |
| RUN-040 | 自动给分支命名：按任务内容生成分支名 | App.tsx generateHarnessBranchName | 自动给分支起名 |
| RUN-043 | 一键 Run 启动开发服务器：用户能在工作区一键跑 dev server | soloyard/services（AddServiceDialog） | 读 package.json 脚本一键启动 |
| RUN-045 | 按工作区查看 / 杀掉监听端口 | soloyard_services.rs（lsof 列端口、Stop） | 看端口、停服务 |
| RUN-047 | 一个会话同时操作多个仓库 | soloyard/core/src/repos.ts、sessionContext.ts（--add-dir / writableRoots） | 多仓库项目，会话可加多个目录 |
| RUN-050 | 保存常用终端命令一键启动 | soloyard/services/history.ts、ServicesNav.tsx、soloyard_services.rs | 「服务」页的历史命令可一键启动 |
| RUN-051 | 自由排布工作区面板 / 弹出独立窗口 | workspace/ui/PaneTree.tsx、TabGroupMenu.tsx、window_transfer.rs | 能拆分窗格，标签组能移到新窗口 |
| RUN-058 | 在会话里打开、编辑文件：用户能在会话旁直接改文件或用外部编辑器打开 | files/ui/FileEditor.tsx、external_editor.rs | 会话旁可编辑文件，也能用外部编辑器打开 |
| RUN-059 | 查看 / 停止会话内的后台任务与子 agent：用户能看到子 agent 实时状态并单独停掉 | sessions/ui/BackgroundJobs.tsx | 列出后台任务和子 agent，可以单独停 |
| RUN-060 | 后台运行 agent 不阻塞界面：用户关掉会话窗口后 agent 继续跑 | 设置 close-to-tray | 关窗口后进托盘，agent 接着跑 |
| RUN-061 | 自建专用 agent：用户能写名称、系统提示、默认任务，建自己的 agent 库 | monos/model/mono.ts、monoHabits.ts | 用 Monos 建自己的 agent |
| RUN-063 | 一个 agent 当协调者派生 / 指挥其他会话：用户能让主 agent 开子会话、发提示、查询和打断其他会话 | docs/agent-access.md、control_cli.rs | 用 /operator 指挥其他会话 |
| RUN-067 | 协调者先给建议线程清单，确认后再启动 | orchestration/ui/OrchestrationPreview.tsx | /orchestrator 先给方案，确认后才启动 |
| RUN-068 | 分别设置协调者和线程的模型 / effort | orchestrationPlan.ts | 每个线程可以单独选模型和 effort |
| RUN-070 | 项目线程改在本机运行（而非云端） | orchestrationWorkspace.ts | 编排的线程本来就在本机跑 |
| RUN-076 | 定时跑 agent 任务：用户能设每小时 / 每天 / cron 等周期自动运行 | automations/model/automations.ts、automations.rs | 有每小时 / 每天 / 工作日 / 每周，没有 cron |
| RUN-078 | 手动立即触发 / 暂停定时任务 | AutomationsView.tsx（Run now、Pause） | 可以立即运行和暂停 |
| RUN-079 | 查看定时任务运行历史：状态、耗时、错误 | AutomationsView.tsx（Run history） | 能看状态、耗时和错误 |
| RUN-080 | 把自动化的一次运行转成普通任务 / 接着追问 | AutomationsView.tsx（run.openSession） | 每次运行就是一个会话，打开就能追问 |
| RUN-081 | 用自然语言创建定时任务 | control_cli.rs（habits.add）、monoCards.ts | 在 Mono 对话里用自然语言建习惯 |
| RUN-088 | 通过 SSH 在远程机器上跑项目 | docs/remote-access.md、remote_ssh.rs | 用 SSH 远程主机跑会话 |
| RUN-094 | 多选任务批量派给 agent：每个任务一个工作区 | soloyard/ui/issues/ParallelStartDialog.tsx | 按子任务批量开工，每个任务一个工作树 |
| RUN-105 | 看到限流警告：接近 / 触达额度时给出琥珀 / 红色提示 | providers/ui/ProviderAccountUsage.tsx、UsageLimitNotice.tsx | 额度条变琥珀 / 红色，到上限有提示 |
| RUN-111 | agent 自动委派给内置子代理（Explore / Plan 等） | AgentTranscript.tsx 的 subagent 展示 | 子代理在转录里能看到 |
| RUN-114 | Ultrafast 极速模式 | claude/claudeCatalog.ts（FAST_MODE） | Claude 模型有 Fast 开关 |
| RUN-122 | Plan 模式：先收集上下文、追问澄清，给出计划再动手 | sessions/model/plan.ts、PlanPreview.tsx | /plan 先出计划，确认后再 Build |
| RUN-123 | 在提示词里 @ 提及文件作为上下文 | sessions/ui/FileMentionPicker.tsx | 能 @ 文件和文件夹 |
| RUN-124 | 在提示里附截图、设计图等图片作为输入 | sessions/model/attachments.ts、useFileDrop.ts | 能附图片和文件 |
| RUN-127 | 一句话把大改动拆给多个 worktree 隔离的子代理并行做（/batch） | orchestrationState.ts、ParallelStartDialog.tsx | 能拆给多个 worker 并行做 |
| RUN-128 | 越界审批交给审查 agent 自动判断代批 | RuntimeMode auto | Auto 模式让 AI 审查后代批 |
| SESS-010 | 删除会话 | sessions/ui/DeleteSessionDialog.tsx | 能删除会话 |
| SESS-011 | 批量删除 / 归档会话 | app/shell/Sidebar.tsx（archiveAll / deleteAll） | 多选后批量归档或删除 |
| SESS-015 | 会话列表按状态 / 日期 / 用户筛选 | sessions/model/sessionFilters.ts | 能按状态、时间、harness 筛选 |
| SESS-041 | 会话记录里自动折叠工具调用，可展开查看 | AgentTranscript.tsx | 命令按组折成一行，可以展开 |
| SESS-042 | 删除单个会话 / 对话 | DeleteSessionDialog.tsx | 能删除单个会话 |
| SESS-043 | 打开任务所在文件夹，或用 IDE 打开 | app/shell/useProjectMenu.tsx、external_editor.rs | 能打开所在文件夹，也能用 IDE 打开 |
| TASK-037 | 状态流转规则与审查 / 审批关口（只有人能批准） | mcp/server.ts、model/acceptIssue.ts | 验收关口只有人能通过 |
| TASK-067 | 按状态 / 优先级 / 负责人筛选和排序任务 | issueView.ts | 能按状态和优先级筛选、排序 |

### v2.0

| 功能 | 描述 | 依据 | 说明 |
|---|---|---|---|
| ACCT-017 | 在设置页内搜索设置项并直达 | SettingsView.tsx（Search settings） | 设置页能搜索并直达 |
| ACCT-051 | 界面正确显示中文（CJK） | src/i18n/locales/zh-CN、i18n.rs | 有完整的简体中文界面 |
| CTX-018 | 内置 AI 通过 MCP / 连接器从外部工具（GitHub、Notion、Sentry…）拉上下文 | settings/ui/McpSettings.tsx、mcpPicker.ts | agent 经 MCP 拉外部上下文 |
| CTX-020 | 让 AI 读代码仓库来规划任务 | sessions/model/plan.ts、orchestrationPlan.ts | Plan 和编排会读仓库来规划 |
| CTX-029 | 外部 agent 通过官方 CLI 读写本产品（含读工作流指南） | control_cli.rs、soloyard/mcp/server.ts | 能经 CLI 和 MCP 读写，MCP 里带流程规则 |
| CTX-040 | 把满意的 agent 流程 / 结果另存为可复用的 skill 或工作流，agent 自动匹配调用 | skills/model/createSkill.ts、SkillsPage.tsx | 能把流程存成 skill |
| IDEA-018 | 先存草稿，成熟后提升为正式条目 | soloyard/core/src/ideas.ts、BrainstormPromoteDialog.tsx | 想法项目可以提升为正式项目 |
| IDEA-019 | AI 把想法 / 会议纪要拆成需求和带验收标准的任务 | mcp/server.ts（create_issues 带 acceptance） | AI 能拆成带验收标准的 issue |
| IDEA-025 | 对话式头脑风暴功能、规划路线图 | soloyard/ui/brainstorm/、IterationsView.tsx | 有对话式头脑风暴和迭代规划 |
| IDEA-030 | 想法评估卡：一键把想法交给 product-thinking 流程生成立项卡 | soloyard/model/overview.ts（runNextStep） | 一键开 product-thinking 立项会话 |
| IDEA-031 | 想法归档 / 拒绝并写原因（「为什么不做」可回看） | ProjectSettingsDialog.tsx、update_project | 搁置 / 放弃时写原因，之后能看 |
| INT-014 | 通过远程 SSH 打开编辑器 | docs/remote-access.md、remoteCommands.ts | 能经 SSH 浏览和编辑远程文件 |
| INT-036 | 读 GitHub / Jira / Confluence 数据作为 AI 上下文 | inbox/model/inboxContext.ts、inboxAsk.ts | GitHub / Jira 内容能当上下文 |
| KB-008 | agent 自动保持文档和项目描述最新 | mcp/server.ts（update_overview、new_doc） | agent 按规则维护 overview 和文档 |
| KB-032 | 上传文件 / 图片作为 AI 上下文（按档位限大小） | sessions/model/attachments.ts | 能附文件和图片给 AI |
| PLAN-004 | 项目概览页 / 仪表盘 | soloyard/ui/overview/OverviewView.tsx、ModuleCards.tsx | 项目主页带各模块卡片 |
| PLAN-035 | 搜索、浏览项目 | projects/ui/SearchableProjectPicker.tsx、ProjectRail | 项目栏浏览加搜索 |
| PLAN-044 | 给项目写 agent 指令文件（AGENTS.md） | soloyard/core/src/repos.ts setProjectInstructions、ReposView.tsx | 项目说明随项目地图注入会话 |
| PLAN-047 | 功能全景 → 迭代：在功能全景里勾选行，一键生成迭代范围和 issue | soloyard/core/src/iterations.ts startIteration | 开始迭代时给勾选功能建 issue |
| RUN-002 | 定时 / 事件触发的后台 agent 自动化（epic）：用户能设一个不用人盯的 agent 流程，按时间或事件自动跑 | automations/model/automations.ts、AutomationsView.tsx | 按时间或 GitHub、Jira 等事件触发 |
| RUN-011 | 新建会话并附初始提示 | quick-composer、soloyard/model/startWork.ts | 新会话可带初始提示词 |
| RUN-035 | 自动识别已有 git worktree：用户在终端里建的 worktree 会被识别并分开管理 | worktrees.rs、WorktreePicker.tsx | 列出并选用已有工作树 |
| RUN-065 | agent 之间交接工作：一个 agent 把部分任务交给另一个 agent | orchestration、sessions/model/handoff.ts | 编排者把任务分给别的 agent |
| RUN-091 | 把 issue 指派给第三方 coding agent（Cursor / Codex / Devin / Claude 等），进度回写 | IssueDetail.tsx Start work、MCP update_issue / add_comment | 选 agent 开工，经 MCP 回写进度 |
| RUN-101 | 在工作区内接入第三方 agent（Claude / Cursor）协作读写文档 | soloyard/mcp/server.ts new_doc / list_docs、DocsView.tsx | Claude / Codex 经 MCP 读写 docs |
| SESS-021 | 集中查看所有已委派 agent 会话及状态（跨仓库） | sessions/ui/LiveAgentsPreview.tsx | 「进行中」跨项目列出 agent 状态 |
| SESS-036 | 重开应用时自动恢复窗口、标签、分屏和最近输出 | workspace/model/workspaceSnapshot.ts | 重开时恢复标签和分屏 |
| TASK-009 | 看父子任务进度 | IssueDetail.tsx 子任务列表和进度 | 详情页列子任务和进度 |
| TASK-010 | 设优先级 | issueView.ts priority、行内改优先级 | 行内和批量都能改 |
| TASK-011 | 打标签 | IssueDetail.tsx Labels、issueView.ts | 能加标签、按标签分组筛选 |
| TASK-022 | 未完成任务自动滚入下一迭代 | iterations.ts finishIteration | 完成迭代时没做完的移到下一迭代 |
| TASK-027 | 看板拖拽改状态 | IssuesView.tsx 看板 onDrop | 拖到别的列就改状态 |
| TASK-035 | 批量选中并批量操作 | model/issueSelection.ts、sidecar updateIssues | 多选批量操作，可整批撤销 |
| TASK-044 | 排序和筛选任务 | model/issueView.ts applyView | 筛选、排序、分组都有 |
| TASK-053 | 给任务写验收标准并逐条勾选 | soloyard_acceptance、IssueDetail.tsx | 验收标准可逐条勾选 |
