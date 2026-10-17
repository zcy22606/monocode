/**
 * 会话里的一个文件（SOL-92）：图片（双指缩放）、网页（整套页面）、Markdown、代码 / 文本、JSON、CSV 在 app 里看；
 * PDF、视频、Office 这些交给手机自带的应用。底下一排：分享（微信 / 飞书）、用其他应用打开、存到手机。
 * 还有会话的「文件」列表：这个会话写过、改过、生成过的文件。
 */
import { useEffect, useRef, useState } from "react";
import { isNumericColumn, parseCsv } from "../../../src/features/soloyard/model/csv";
import type { SessionFile } from "../../../soloyard/core/src/session-files";
import { android, fileError, fileInfo, fileUrl, shortPath, type FileInfo, type FileSource } from "../host/files";
import { listServices, openLocalService, type LocalService } from "../host/host";
import { Globe } from "../../../src/shared/ui/icons";
import { t, useTranslation } from "../i18n";
import { FileTypeIcon, formatRelative } from "../ui/desktop";
import { Icon, type IconName } from "../ui/icons";
import { Sheet, Spinner, haptic, toast, useSheet } from "../ui/kit";
import { useNav, type Route } from "../ui/nav";
import { Markdown } from "./blocks";

type View = "image" | "html" | "markdown" | "json" | "csv" | "tsv" | "text" | "other";
/** 文本超过这么大不在 app 里排版（太慢），交给别的应用。 */
const TEXT_LIMIT = 2 << 20;

function viewOf(info: FileInfo): View {
  const { mime } = info;
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/html") return "html";
  if (info.size > TEXT_LIMIT) return "other";
  if (mime === "text/markdown") return "markdown";
  if (mime === "application/json") return "json";
  if (mime === "text/csv") return "csv";
  if (mime === "text/tab-separated-values") return "tsv";
  if (mime.startsWith("text/") || /xml|javascript/.test(mime)) return "text";
  return "other";
}

export const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1 << 20 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1 << 20)).toFixed(1)} MB`;

export function FileScreen({ route }: { route: Extract<Route, { name: "file" }> }) {
  useTranslation();
  const nav = useNav();
  const source = { source: route.source, id: route.id };
  const [info, setInfo] = useState<FileInfo>();
  const [error, setError] = useState<string>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    fileInfo(source, route.path).then(
      (next) => live && setInfo(next),
      (e) => live && setError(fileError(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.source, route.id, route.path, round]);

  const name = route.path.split("/").pop() || route.path;
  const view = info && viewOf(info);
  const url = fileUrl(source, route.path);
  const act = (action: "share" | "open" | "save") => {
    if (!info) return;
    haptic();
    android(action, info).then(
      () => action === "save" && toast(t("files.saved")),
      (e: Error) => toast(e.message),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-stroke pb-1.5 pl-1 pr-2" style={{ paddingTop: "calc(var(--safe-top) + 6px)" }}>
        <button aria-label="back" className="press grid size-11 shrink-0 place-items-center rounded-full text-content/70 active:bg-selection" onClick={nav.back}>
          <Icon name="back" size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">{name}</div>
          <div className="truncate text-xs text-content/45" dir="rtl">
            {/* 长路径从左边省略，留住文件夹名 */}
            <bdi>{info ? `${shortPath(route.path.slice(0, -name.length - 1)) || "/"} · ${formatSize(info.size)}` : shortPath(route.path)}</bdi>
          </div>
        </div>
        <button
          aria-label={t("files.refresh")}
          className="press grid size-11 shrink-0 place-items-center rounded-full text-content/60 active:bg-selection"
          onClick={() => {
            haptic();
            setRound((n) => n + 1);
          }}
        >
          <Icon name="refresh" size={19} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {!info && !error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-content/45">
            <Spinner size={20} />
            {t(route.source === "host" ? "files.loadingHost" : "files.loading")}
          </div>
        ) : null}
        {error && !info ? <FileProblem message={error} onRetry={() => setRound((n) => n + 1)} /> : null}
        {info && view ? <FileView key={`${info.mtime}:${round}`} view={view} info={info} url={url} onOpen={() => act("open")} /> : null}
        {error && info ? <div className="absolute inset-x-3 top-2 rounded-lg bg-amber/12 px-3 py-2 text-[12px] text-amber">{error}</div> : null}
      </div>

      {info ? (
        <div className="grid shrink-0 grid-cols-3 border-t border-stroke px-2 pt-1" style={{ paddingBottom: "calc(var(--safe-bottom) + 4px)" }}>
          <Action icon="share" label={t("files.share")} onClick={() => act("share")} />
          <Action icon="openWith" label={t("files.openWith")} onClick={() => act("open")} />
          <Action icon="download" label={t("files.save")} onClick={() => act("save")} />
        </div>
      ) : null}
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button className="press flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] text-content/60 active:bg-selection" onClick={onClick}>
      <Icon name={icon} size={20} className="text-content/80" />
      {label}
    </button>
  );
}

function FileProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
      <Icon name="alert" size={26} className="text-content/35" />
      <div className="text-[14px] leading-relaxed text-content/60">{message}</div>
      <button className="press mt-1 rounded-full bg-selection px-4 py-2 text-[13px]" onClick={onRetry}>
        {t("files.retry")}
      </button>
    </div>
  );
}

function FileView({ view, info, url, onOpen }: { view: View; info: FileInfo; url: string; onOpen: () => void }) {
  if (view === "image") return <ZoomImage src={url} alt={info.name} />;
  // 页面在沙箱里跑（脚本能跑，碰不到 app），样式、脚本、图片按相对路径照样从电脑取
  if (view === "html") return <iframe title={info.name} src={url} sandbox="allow-scripts" className="h-full w-full border-0 bg-white" />;
  if (view === "other") return <OtherFile info={info} onOpen={onOpen} />;
  return <TextFile view={view} info={info} url={url} />;
}

function TextFile({ view, info, url }: { view: View; info: FileInfo; url: string }) {
  const [text, setText] = useState<string>();
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => r.text())
      .then((value) => live && setText(value), () => live && setText(""));
    return () => {
      live = false;
    };
  }, [url]);
  if (text === undefined)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );
  if (view === "csv" || view === "tsv") return <CsvTable text={text} delimiter={view === "tsv" ? "\t" : ","} />;
  let body = text;
  let lang = info.name.split(".").pop()?.toLowerCase() ?? "";
  if (view === "json") {
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // 不是合法 JSON 就原样显示
    }
    lang = "json";
  }
  // 代码放进围栏里高亮；围栏比文件里最长的一串反引号还长，内容里的 ``` 不会把它截断
  const fence = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return (
    <div className="scroll-y h-full px-4 py-3">
      {view === "markdown" ? <Markdown text={frontMatterAsCode(text)} /> : <Markdown text={`${fence}${lang}\n${body}\n${fence}`} lineNumbers />}
    </div>
  );
}

/** 开头的 YAML front matter 不当正文排（会被当成标题），换成一小段代码。 */
const frontMatterAsCode = (text: string) => text.replace(/^---\n([\s\S]*?)\n---\n/, (_, yaml: string) => `\`\`\`yaml\n${yaml}\n\`\`\`\n`);

const CSV_ROWS = 1000;

function CsvTable({ text, delimiter }: { text: string; delimiter: string }) {
  const { rows, more } = parseCsv(text, delimiter, CSV_ROWS + 1);
  const [head = [], ...body] = rows;
  const columns = Math.max(head.length, ...body.map((r) => r.length));
  const numeric = Array.from({ length: columns }, (_, c) => isNumericColumn(body, c));
  return (
    <div className="flex h-full flex-col px-3 py-2">
      <div className="pb-2 text-[12px] text-content/45">
        {t("files.csvSize", { rows: body.length, columns })}
        {more ? ` · ${t("files.csvFirst", { count: CSV_ROWS })}` : ""}
      </div>
      {/* 不撑满：表格多高边框多高，超出了在框里滚 */}
      <div className="scroll-y min-h-0 overflow-x-auto rounded-xl border border-stroke">
        <table className="min-w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 bg-raised">
            <tr>
              <th className="border-b border-stroke px-2 py-1.5 text-right font-normal text-content/30">#</th>
              {Array.from({ length: columns }, (_, c) => (
                <th key={c} className={`whitespace-nowrap border-b border-stroke px-2 py-1.5 font-semibold ${numeric[c] ? "text-right" : "text-left"}`}>
                  {head[c] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-b border-stroke/60 last:border-0">
                <td className="px-2 py-1 text-right text-content/30">{r + 1}</td>
                {Array.from({ length: columns }, (_, c) => (
                  <td key={c} className={`max-w-[16rem] truncate whitespace-nowrap px-2 py-1 text-content/80 ${numeric[c] ? "text-right" : ""}`}>
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OtherFile({ info, onOpen }: { info: FileInfo; onOpen: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
      <FileTypeIcon name={info.name} isDir={false} size={56} />
      <div className="mt-1 break-all text-[15px] font-medium">{info.name}</div>
      <div className="text-[12px] text-content/45">{formatSize(info.size)}</div>
      <div className="text-[13px] text-content/55">{t(info.mime === "application/pdf" ? "files.pdfHint" : "files.otherHint")}</div>
      <button className="press mt-2 rounded-full bg-accent px-5 py-2.5 text-[14px] font-medium text-white" onClick={onOpen}>
        {t("files.openWith")}
      </button>
    </div>
  );
}

/** 双指缩放、单指拖动（放大以后）、双击放大 / 还原。 */
function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef({ distance: 0, scale: 1, x: 0, y: 0, cx: 0, cy: 0 });
  const lastTap = useRef(0);
  const [failed, setFailed] = useState(false);

  const center = () => {
    const [a, b = a] = [...points.current.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const begin = () => {
    if (points.current.size) start.current = { ...center(), scale: view.scale, x: view.x, y: view.y };
  };

  if (failed) return <FileProblem message={t("files.error.image")} onRetry={() => setFailed(false)} />;
  return (
    <div
      className="flex h-full touch-none items-center justify-center overflow-hidden bg-black/30"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        begin();
        if (points.current.size === 1) {
          const now = performance.now();
          if (now - lastTap.current < 280) setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
          lastTap.current = now;
        }
      }}
      onPointerMove={(e) => {
        if (!points.current.has(e.pointerId)) return;
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const s = start.current;
        const c = center();
        const scale = points.current.size > 1 && s.distance ? Math.min(6, Math.max(1, (s.scale * c.distance) / s.distance)) : view.scale;
        if (scale <= 1 && points.current.size === 1) return;
        setView({ scale, x: s.x + c.cx - s.cx, y: s.y + c.cy - s.cy });
      }}
      onPointerUp={(e) => {
        points.current.delete(e.pointerId);
        begin();
        setView((v) => (v.scale <= 1.02 ? { scale: 1, x: 0, y: 0 } : v));
      }}
      onPointerCancel={(e) => points.current.delete(e.pointerId)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full select-none object-contain"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: points.current.size ? "none" : "transform 200ms ease-out" }}
      />
    </div>
  );
}

const KIND: Record<SessionFile["kind"], string> = { write: "files.kind.write", image: "files.kind.image", attachment: "files.kind.attachment" };

/** 会话的「文件」：写过、改过、生成过、发过的文件，新的在前。 */
export function FilesSheet({
  open,
  onClose,
  source,
  load,
  onOpen,
  onService,
}: {
  open: boolean;
  onClose: () => void;
  source: FileSource;
  load: () => Promise<SessionFile[]>;
  onOpen: (path: string) => void;
  onService: (service: LocalService) => Promise<void>;
}) {
  const { cwd } = source;
  const [files, setFiles] = useState<SessionFile[]>();
  const [services, setServices] = useState<LocalService[]>([]);
  const [opening, setOpening] = useState<number>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    load().then(setFiles, (e) => setError(fileError(e)));
    // 列不出来（电脑不在线等）就不显示这一块，文件那边会说原因
    listServices(source.source, source.id).then(setServices, () => setServices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const shown = (path: string) => (path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : shortPath(path));
  return (
    <Sheet open={open} onClose={onClose} title={t("files.title")}>
      {services.length ? (
        <>
          <div className="px-3 pb-1 pt-1 text-[12px] text-content/45">{t("files.services")}</div>
          {services.map((service) => (
            <button
              key={service.port}
              disabled={opening !== undefined}
              className="press-row flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left"
              onClick={() => {
                setOpening(service.port);
                void onService(service).finally(() => setOpening(undefined));
              }}
            >
              {opening === service.port ? <Spinner size={22} /> : <Globe className="size-[22px] shrink-0 text-sky-300/80" strokeWidth={1.5} />}
              <div className="min-w-0 flex-1 truncate font-mono text-[15px]">localhost:{service.port}</div>
              <div className="shrink-0 text-[11px] text-content/40">{service.command}</div>
            </button>
          ))}
          <div className="px-3 pb-1 pt-3 text-[12px] text-content/45">{t("files.filesHeading")}</div>
        </>
      ) : null}
      {error ? <div className="px-3 py-6 text-center text-[13px] text-content/50">{error}</div> : null}
      {!files && !error ? (
        <div className="flex justify-center py-8">
          <Spinner size={18} />
        </div>
      ) : null}
      {files?.length === 0 ? <div className="px-3 py-8 text-center text-[13px] text-content/45">{t("files.empty")}</div> : null}
      {files?.map((f) => {
        const rel = shown(f.path);
        const name = rel.split("/").pop() ?? rel;
        const dir = rel.slice(0, -name.length - 1);
        return (
          <button key={f.path} className="press-row flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left" onClick={() => onOpen(f.path)}>
            <FileTypeIcon name={name} isDir={false} size={22} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px]">{name}</div>
              {/* 长路径从左边省略，留住离文件最近的文件夹 */}
              {dir ? (
                <div className="truncate text-[12px] text-content/45" dir="rtl">
                  <bdi>{dir}</bdi>
                </div>
              ) : null}
            </div>
            <div className="shrink-0 text-right text-[11px] leading-tight text-content/40">
              <div>{t(KIND[f.kind])}</div>
              {f.at ? <div>{formatRelative(f.at)}</div> : null}
            </div>
          </button>
        );
      })}
    </Sheet>
  );
}

/** 会话页右上角的「文件」按钮和它的列表。source 还没有（会话没加载出来）时按钮灰着。 */
export function SessionFiles({ source, load }: { source: FileSource | null; load: () => Promise<SessionFile[]> }) {
  const sheet = useSheet<true>();
  const nav = useNav();
  return (
    <>
      <button
        aria-label={t("files.title")}
        disabled={!source}
        className="press grid size-11 shrink-0 place-items-center rounded-full text-content/60 active:bg-selection disabled:opacity-40"
        onClick={() => {
          haptic();
          sheet.open(true);
        }}
      >
        <Icon name="folder" size={20} />
      </button>
      {source ? (
        <FilesSheet
          open={!!sheet.value}
          onClose={sheet.close}
          source={source}
          load={load}
          onService={({ port }) =>
            openLocalService(source.source, source.id, port).then(
              ({ url }) => sheet.close().then(() => nav.push({ name: "web", url, port })),
              (e) => toast(fileError(e)),
            )
          }
          // 等面板关掉（历史记录退回去）再推新页面，不然返回键的顺序会乱
          onOpen={(path) => void sheet.close().then(() => nav.push({ name: "file", source: source.source, id: source.id, path }))}
        />
      ) : null}
    </>
  );
}
