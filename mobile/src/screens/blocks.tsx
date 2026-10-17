/** 会话里的一块块内容：用户消息、agent 的 Markdown、工具调用、思考、任务清单、计划、系统提示。 */
import { memo, useContext, useLayoutEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import type { Block } from "../host/host";
import type { BackgroundJob, HarnessId } from "../../../src/features/sessions/model/session";
import { Bot, Check, ChevronRight, CircleAlert, CircleDashed, Copy, ListEnd, Loader, Minus, PenLine, Search, Square, Terminal, Wrench, X } from "../../../src/shared/ui/icons";
import { workKind, workSummary } from "../ui/activity";
import { t, useTranslation } from "../i18n";
import { Icon } from "../ui/icons";
import { FileTypeIcon, HarnessIcon, Shimmer, TerminalSpinner, dayStamp, formatClockTime, formatElapsed, splitToolLabel, toolKind, toolLabel } from "../ui/desktop";
import { haptic, toast } from "../ui/kit";
import { FileSourceContext, android, fileUrl, localService, looksLikeFile, toAbsolute, useOpenFile, useOpenService } from "../host/files";

const PLUGINS = { code };

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  haptic();
  toast(t("session.copied"));
}

/** 电脑上消息下面的复制：只有图标，点了变对勾 2 秒。 */
export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={t("session.copyMessage")}
      className={`press grid size-8 place-items-center rounded-md text-content/40 ${className}`}
      onClick={() => {
        void copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3.5" strokeWidth={1.75} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
    </button>
  );
}

/** 链接指向的本地文件（绝对路径、~/、file://、相对路径的文件名），去掉行号；不是就 undefined。 */
function localTarget(href: string) {
  if (/^file:\/\//.test(href)) return href.slice(7).replace(/#.*$/, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return undefined;
  return href.startsWith("/") || href.startsWith("~/") ? href.replace(/(?:#L\d+(?:-L\d+)?|:\d+(?::\d+)?)$/, "") : looksLikeFile(href);
}

/**
 * agent 的 Markdown。流式输出时逐词淡入、末尾跟一个光标。
 * 在会话里时：本地文件的链接、像文件路径的行内代码点了打开文件（SOL-92），localhost 的链接打开那台机器上的服务（SOL-97）；
 * 别的网址用浏览器打开，打不开就复制。
 */
export const Markdown = memo(function Markdown({ text, streaming, lineNumbers = false }: { text: string; streaming?: boolean; lineNumbers?: boolean }) {
  const openFile = useOpenFile();
  const openService = useOpenService();
  const box = useRef<HTMLDivElement>(null);
  // 像文件路径的行内代码标出来（样式见 styles.css 的 .file-ref），看得出能点
  useLayoutEffect(() => {
    if (!openFile) return;
    for (const code of box.current?.querySelectorAll<HTMLElement>(":not(pre) > code") ?? []) code.classList.toggle("file-ref", !!looksLikeFile(code.textContent ?? ""));
  });
  return (
    <div
      ref={box}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement;
        const code = target.closest(":not(pre) > code");
        const inline = code && openFile ? looksLikeFile(code.textContent ?? "") : undefined;
        if (inline) {
          e.preventDefault();
          haptic(4);
          return openFile!(inline);
        }
        const link = target.closest("a");
        if (!link) return;
        e.preventDefault();
        const href = link.getAttribute("href") ?? "";
        const local = localTarget(href);
        if (local && openFile) return openFile(decodeURI(local));
        // 会话那台机器上的开发服务器（SOL-97）：那台机器开好转发再在 app 里打开
        const service = localService(href);
        if (service && openService) return void openService(service.port, service.path);
        if (/^https?:\/\//i.test(href)) return void android("browse", href).catch(() => copyText(href));
        void copyText(link.href);
      }}
    >
      <Streamdown
        className="agent-md"
        mode={streaming ? "streaming" : "static"}
        isAnimating={!!streaming}
        animated={!!streaming}
        caret={streaming ? "circle" : undefined}
        controls={{ code: true, table: false, mermaid: false }}
        lineNumbers={lineNumbers}
        plugins={PLUGINS}
        shikiTheme={["github-dark", "github-dark"]}
        linkSafety={{ enabled: false }}
      >
        {text}
      </Streamdown>
    </div>
  );
});

export function UserBubble({
  text,
  attachments = [],
  state,
  onRetry,
  at,
}: {
  text: string;
  attachments?: { kind: string }[];
  state?: "sending" | "queued" | "failed";
  onRetry?: () => void;
  /** 发出的时间：有就在气泡下面显示复制和时间（和电脑一样）。 */
  at?: number;
}) {
  useTranslation();
  const images = attachments.filter((a) => a.kind === "image").length;
  const files = attachments.length - images;
  // 和电脑一样：一行的是胶囊，多行的是圆角；超过 4 行先折起来
  const ref = useRef<HTMLPreElement>(null);
  const [shape, setShape] = useState({ singleLine: true, overflows: false });
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    setShape({ singleLine: el.clientHeight < line * 1.5 && !images && !files, overflows: el.scrollHeight > el.clientHeight + 1 });
  }, [text, images, files]);
  return (
    <div className="flex flex-col items-end">
      <div
        className={`user-bubble max-w-[86%] px-3.5 py-2 transition-opacity ${shape.singleLine && !expanded ? "rounded-[20px]" : "rounded-xl"} ${
          state === "sending" || state === "queued" ? "opacity-70" : ""
        }`}
      >
        {text ? (
          <pre ref={ref} className={`whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.5] text-content ${expanded ? "" : "line-clamp-4"}`}>
            {text}
          </pre>
        ) : null}
        {shape.overflows || expanded ? (
          <button className="press mt-1 rounded px-1 py-0.5 text-xs text-content/60" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("session.showLess") : t("session.showMore")}
          </button>
        ) : null}
        {images ? <div className="mt-1 text-xs text-content/50">{t("session.images", { count: images })}</div> : null}
        {files ? <div className="mt-1 text-xs text-content/50">{t("session.attachments", { count: files })}</div> : null}
      </div>
      {at && !state ? (
        <div className="flex items-center gap-0.5 pt-0.5 text-content/40">
          <CopyButton text={text} />
          <time className="pr-1 text-xs">{formatClockTime(at)}</time>
        </div>
      ) : null}
      {state === "queued" ? <div className="mt-1 text-[11px] text-content/40">{t("session.queued")}</div> : null}
      {state === "failed" ? (
        <button className="press mt-1 flex items-center gap-1 text-[12px] text-red" onClick={onRetry}>
          <Icon name="retry" size={13} /> {t("session.sendFailed")}
        </button>
      ) : null}
    </div>
  );
}

/** 用户消息下面一行「Opus 5.5 工作了 12m 7s」（和电脑一样，模型 logo 打头）。 */
export function TurnDone({ block }: { block: Block }) {
  const who = block.turnModel?.name;
  const time = formatElapsed(block.durationMs ?? 0);
  return (
    <div className="mt-3 flex items-center gap-1.5 text-[14px] text-content/50">
      {block.turnModel?.harness ? <HarnessIcon harness={block.turnModel.harness as HarnessId} className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{who ? t("session.doneWhoFor", { who, time }) : t("session.doneFor", { time })}</span>
    </div>
  );
}

/** 正在干活：和电脑一样一行流光字「Opus 5.5 工作中 12s」，还没输出时是「思考中…」。 */
export function WorkingLine({ block, now }: { block?: Block; now: number }) {
  useTranslation();
  const who = block?.turnModel?.name;
  const started = block?.startedAt;
  const text = started ? (who ? t("session.workingWhoFor", { who, time: formatElapsed(now - started) }) : t("session.workingFor", { time: formatElapsed(now - started) })) : t("session.thinking");
  return (
    <div className="flex items-center gap-1.5">
      {block?.turnModel?.harness ? <HarnessIcon harness={block.turnModel.harness as HarnessId} className="size-3.5 shrink-0" /> : null}
      <Shimmer className="min-w-0 truncate text-[14px]" duration={1.6}>
        {text}
      </Shimmer>
    </div>
  );
}

/** 对话里换了一天：和电脑一样的胶囊（加粗的日子 + 时间）。 */
export function DaySeparator({ at }: { at: number }) {
  useTranslation();
  const [day, time] = dayStamp(at);
  return (
    <div className="flex justify-center pb-1 pt-4 text-[12px]">
      <span className="rounded-full bg-content/[0.07] px-3 py-1 leading-4">
        <span className="font-semibold text-content/75">{day}</span> <span className="text-content/45">{time}</span>
      </span>
    </div>
  );
}

const KIND_ICON = { edit: PenLine, research: Search, run: Terminal, agent: Bot, other: Wrench } as const;
const RUNNING = /^(running|pending|in_progress|started)$/i;
const FAILED = /^(failed|error|rejected)$/i;

/** 工具调用：和电脑一样「图标 动作 目标」一行，在跑是转着的虚线圈、失败尾巴一个红叉；点开看输出或改动。 */
export function ToolRow({ block, cwd }: { block: Block; cwd?: string }) {
  const [open, setOpen] = useState(false);
  const status = block.tool?.status ?? "";
  const preview = block.tool?.preview;
  const steps = block.agentRun?.steps ?? [];
  const label = toolLabel(block, cwd);
  const { action, target, isFile } = splitToolLabel(label);
  const expandable = !!(preview?.lines?.length || preview?.output || block.tool?.detail || steps.length);
  const waiting = block.approval && !block.approval.decided;
  const running = RUNNING.test(status) && !waiting;
  const failed = FAILED.test(status);
  const KindIcon = KIND_ICON[toolKind(block, label)];
  const openFile = useOpenFile();
  // 读过、改过的文件点文件名打开（SOL-92）；行的其余地方照旧展开输出或改动
  const file = isFile && action !== "List" && openFile ? (preview?.path ?? target) : undefined;
  return (
    <div>
      <button
        aria-disabled={!expandable}
        className={`${expandable ? "press-row" : ""} flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left`}
        onClick={() => {
          if (!expandable) return;
          haptic(4);
          setOpen((v) => !v);
        }}
      >
        {running ? (
          <CircleDashed className="zen-tool-spin size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
        ) : (
          <KindIcon className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
        )}
        {block.agentRun?.name ? <span className="shrink-0 text-[14px] text-content/50">{block.agentRun.name} ·</span> : null}
        {action ? (
          <>
            <span className={`shrink-0 text-[14px] ${failed ? "text-red-400" : "text-content/50"}`}>{action}</span>
            <span
              className={`flex min-w-0 items-center gap-1 font-mono text-[13px] ${isFile ? "" : "pl-1"} ${failed ? "text-red-400" : "text-content/85"} ${file ? "rounded active:bg-selection" : ""}`}
              onClick={
                file
                  ? (e) => {
                      e.stopPropagation();
                      haptic(4);
                      openFile!(file);
                    }
                  : undefined
              }
            >
              {isFile ? <FileTypeIcon name={target.split("/").pop() || target} isDir={action === "List"} /> : null}
              <span className="min-w-0 truncate">{target}</span>
            </span>
          </>
        ) : (
          <span className={`min-w-0 truncate font-mono text-[13px] ${failed ? "text-red-400" : "text-content/80"}`}>{label}</span>
        )}
        <span className="flex-1" />
        {waiting ? <span className="shrink-0 rounded-full bg-amber/15 px-2 py-0.5 text-[11px] text-amber">{t("session.waitingApproval")}</span> : null}
        {failed ? <X className="size-3.5 shrink-0 text-red-400" strokeWidth={2} /> : null}
      </button>
      {open ? (
        <div className="fade-in ml-5 mt-1 space-y-2">
          {preview?.lines?.length ? (
            <div className="scroll-y max-h-72 overflow-x-auto rounded-[10px] border border-content/10 bg-content/[0.035] py-1.5 font-mono text-[11.5px] leading-[1.55]">
              {preview.lines.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre px-2.5 ${line.kind === "add" ? "bg-emerald-400/10 text-emerald-300" : line.kind === "del" ? "bg-red-400/10 text-red-300" : "text-content/60"}`}
                >
                  {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                  {line.text}
                </div>
              ))}
            </div>
          ) : null}
          {preview?.output || block.tool?.detail ? (
            <pre className="scroll-y max-h-72 overflow-x-auto whitespace-pre-wrap break-words rounded-[10px] border border-content/10 bg-content/[0.035] px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] text-content/60">
              {preview?.output || block.tool?.detail}
            </pre>
          ) : null}
          {steps.length ? (
            <div className="space-y-1 border-l border-stroke pl-3 text-[12px] text-content/45">
              {steps.slice(-30).map((step) => (
                <div key={step.id} className="truncate">
                  {step.text}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 思考：和电脑一样整段灰色直接显示（SOL-91），还没内容时是流光的「思考中…」。 */
export function Reasoning({ block }: { block: Block }) {
  useTranslation();
  if (!block.text.trim())
    return (
      <Shimmer className="text-[14px]" duration={1.6}>
        {t("session.thinking")}
      </Shimmer>
    );
  return (
    <div className="agent-reasoning">
      <Markdown text={block.text} streaming={block.streaming} />
    </div>
  );
}

/** 任务清单：照电脑的 TaskListPreview。 */
export function TaskList({ block }: { block: Block }) {
  useTranslation();
  const items = block.taskList?.items ?? [];
  const done = items.filter((i) => i.status === "completed").length;
  const actionable = items.filter((i) => i.status !== "cancelled").length;
  return (
    <section className="overflow-hidden rounded-[10px] border border-content/10 bg-content/[0.035]">
      <div className="flex items-center gap-2 border-b border-stroke px-3 py-2">
        <ListEnd className="size-4 shrink-0 text-content/45" strokeWidth={1.75} />
        <h3 className="flex-1 font-mono text-[12.5px] font-medium text-content/85">{t("session.tasksTitle")}</h3>
        <span className="shrink-0 rounded-full bg-content/7 px-2 py-0.5 font-mono text-[10.5px] text-content/50">
          {actionable > 0 && done === actionable ? t("session.tasksComplete") : t("session.tasks", { done, total: actionable || items.length })}
        </span>
      </div>
      <ol className="py-1">
        {items.map((item, i) => (
          <li key={item.id ?? i} className="flex min-w-0 items-start gap-2.5 px-3 py-1.5">
            <TaskState status={item.status} />
            <span
              className={`min-w-0 flex-1 text-[14px] leading-5 ${
                item.status === "completed"
                  ? "text-content/40 line-through decoration-content/25"
                  : item.status === "cancelled"
                    ? "text-content/35 line-through decoration-content/20"
                    : item.status === "in_progress"
                      ? "text-content/85"
                      : "text-content/60"
              }`}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TaskState({ status }: { status: string }) {
  if (status === "completed")
    return (
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
        <Check className="size-2.5" strokeWidth={2.5} />
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-sky-300">
        <Loader className="size-3.5 animate-spin" strokeWidth={2} />
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-content/8 text-content/35">
        <Minus className="size-2.5" strokeWidth={2} />
      </span>
    );
  return <span className="mt-0.5 size-4 shrink-0 rounded-full border border-content/25 bg-content/[0.02]" />;
}

/** 你用 `!` 跑的命令（照抄电脑 ShellCommandRow）：是你的不是 agent 的，单独一张卡片。 */
export function ShellRow({ block }: { block: Block }) {
  const shell = block.shell;
  if (!shell) return null;
  const running = shell.status === "running";
  const failed = shell.status === "failed" || (shell.exitCode ?? 0) !== 0;
  const outcome = running
    ? t("shellCommand.running")
    : shell.status === "stopped"
      ? t("shellCommand.stopped")
      : shell.status === "failed"
        ? t("shellCommand.failed")
        : shell.exitCode != null
          ? t("shellCommand.exit", { code: shell.exitCode })
          : t("shellCommand.killed");
  const stdout = shell.stdout?.replace(/\n+$/, "");
  const stderr = shell.stderr?.replace(/\n+$/, "");
  return (
    <div aria-label={t("shellCommand.label", { command: block.text })} className="overflow-hidden rounded-lg border border-content/10 bg-content/[0.03] font-mono text-[12px] leading-5">
      <div className="flex min-w-0 items-start gap-2 px-3 py-1.5">
        <span aria-hidden="true" className="shrink-0 text-content/40">
          !
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-content/85">{block.text}</span>
        <span className={`flex shrink-0 items-center gap-1.5 font-sans text-[11px] ${failed ? "text-red-400" : "text-content/45"}`}>
          {running ? <TerminalSpinner className="inline-block w-3.5 select-none text-center text-[11px] leading-none" /> : null}
          {outcome}
        </span>
      </div>
      {stdout || stderr ? (
        <pre className="scroll-y max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-words border-t border-stroke px-3 py-2 text-content/65">
          {stdout}
          {stdout && stderr ? "\n" : null}
          {stderr ? <span className="text-red-400/80">{stderr}</span> : null}
        </pre>
      ) : null}
      {shell.truncated ? <div className="border-t border-stroke px-3 py-1 font-sans text-[11px] text-content/45">{t("shellCommand.truncated")}</div> : null}
    </div>
  );
}

/**
 * 还在后台跑的任务（照电脑 BackgroundJobs）：贴在输入框上方，每行名字、命令、已运行时间、停止键。
 * 停了交给电脑去停，任务真结束了才从列表里消失；交不出去把停止键还回来。
 */
export function BackgroundJobs({ jobs, now, onStop }: { jobs?: BackgroundJob[]; now: number; onStop?: (jobId: string) => Promise<unknown> }) {
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  if (!jobs?.length) return null;
  const stop = (jobId: string) => {
    if (!onStop) return;
    haptic(8);
    setStopping((ids) => new Set(ids).add(jobId));
    onStop(jobId).catch((e: Error) => {
      toast(e.message);
      setStopping((ids) => {
        const next = new Set(ids);
        next.delete(jobId);
        return next;
      });
    });
  };
  return (
    <div className="shrink-0 px-3 text-content/55">
      <div className="rounded-t-[12px] border border-b-0 border-content/10 bg-content/[0.03] px-3 py-1">
        {jobs.map((job, index) => {
          const Icon = job.command ? Terminal : Bot;
          return (
            <div key={job.id} className={`flex min-h-10 items-center gap-2 text-[13px] ${index ? "border-t border-stroke" : ""} ${stopping.has(job.id) ? "opacity-50" : ""}`}>
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="max-w-[45%] shrink-0 truncate text-content/80">{job.title}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-content/40">{job.command}</span>
              <span className="shrink-0 tabular-nums">{formatElapsed(Math.max(0, now - job.startedAt))}</span>
              {onStop ? (
                <button
                  aria-label={t("backgroundJobs.stopLabel", { title: job.title })}
                  disabled={stopping.has(job.id)}
                  className="press -mr-2 grid size-10 shrink-0 place-items-center rounded-md text-content/55"
                  onClick={() => stop(job.id)}
                >
                  <Square className="size-3 fill-current" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Step = ({ block, cwd }: { block: Block; cwd?: string }) => (block.role === "system" ? <SystemRow block={block} /> : <ToolRow block={block} cwd={cwd} />);

/**
 * 一段工作（照电脑 ActivityPhaseGroup）：只有一步的直接显示那一行；多步的收成一行「已读取 3 个文件 · 运行了 2 个命令」，
 * 点开看每一步。正在跑的那段自己展开、标题流光，跑完收起来。
 */
export function WorkGroup({ steps, cwd, active }: { steps: Block[]; cwd?: string; active: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null);
  if (steps.length === 1) return <Step block={steps[0]} cwd={cwd} />;
  const open = override ?? active;
  const title = workSummary(steps, active);
  const kind = workKind(steps);
  const KindIcon = kind === "note" ? Minus : KIND_ICON[kind];
  return (
    <div>
      <button
        aria-expanded={open}
        className="press-row flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left"
        onClick={() => {
          haptic(4);
          setOverride(!open);
        }}
      >
        <KindIcon className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
        {active ? (
          <Shimmer className="min-w-0 truncate text-[14px]" duration={1.6}>
            {title}
          </Shimmer>
        ) : (
          <span className="min-w-0 truncate text-[14px] text-content/50">{title}</span>
        )}
        <ChevronRight className={`size-3.5 shrink-0 text-content/35 transition-transform duration-200 ${open ? "rotate-90" : ""}`} strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="fade-in ml-[6px] border-l border-stroke pl-3">
          {steps.map((block) => (
            <Step key={block.id} block={block} cwd={cwd} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SystemRow({ block }: { block: Block }) {
  if (block.notice)
    return (
      <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] ${block.notice === "error" ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
        <span className="whitespace-pre-wrap break-words">{block.text}</span>
      </div>
    );
  return <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-content/50">{block.text}</div>;
}

/** 主机起的标题带着「claude · 」前缀，手机上模型另外显示，去掉。 */
export const cleanTitle = (title: string) => title.replace(/^[a-z]+\s*·\s*/i, "");

/** 生成的图片：在会话里直接显示，点了打开大图（SOL-92）。 */
export function ImageBlock({ block }: { block: Block }) {
  const source = useContext(FileSourceContext);
  const openFile = useOpenFile();
  const [failed, setFailed] = useState(false);
  const path = block.image?.path;
  if (!path || !source || !openFile || failed) return <div className="text-[13px] text-content/45">{block.image?.name ?? t("session.image")}</div>;
  return (
    <button className="press block max-w-[85%] overflow-hidden rounded-xl border border-stroke" onClick={() => openFile(path)}>
      <img src={fileUrl(source, toAbsolute(path, source.cwd))} alt={block.image?.alt ?? block.image?.name ?? ""} loading="lazy" className="max-h-72 w-auto" onError={() => setFailed(true)} />
    </button>
  );
}

/** 哪些块显示：内部的、草稿、自动发的不显示。 */
export function visibleBlock(block: Block) {
  if (block.internal || block.draft || block.monoSessionCompletion) return false;
  if (block.role === "assistant" || block.role === "reasoning") return !!block.text.trim() || !!block.streaming;
  // 电脑上以后加的块手机还不认识：有文字就按普通的灰字显示（BlockView 的 default），不藏掉
  return ["user", "tool", "approval", "tasks", "plan", "system", "handoff", "image", "shell"].includes(block.role) || !!block.text?.trim();
}
