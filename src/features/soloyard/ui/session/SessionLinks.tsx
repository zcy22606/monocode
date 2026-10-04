/**
 * Soloyard：会话输入框里的关联按钮和弹层。关联的文件夹 / 文件 / issue / 文档 / 功能 / 决策
 * 在输入框里 @link/… 引用时才把内容发给 agent（见 model/sessionMentions.ts、model/sessionContext.ts）。
 */
import { useRef, useState, type ComponentType } from "react";
import { useTranslation } from "../../../../i18n";
import { pickFiles, pickFolders, revealPath } from "../../../../platform/tauri/fs";
import { Popover } from "../../../../shared/ui/Popover";
import {
  ArrowLeft,
  Attachment,
  Book,
  CheckSquare,
  Folder,
  Link,
  MessageSquare,
  Plus,
  Puzzle,
  Scale,
  Search,
  Star,
  X,
} from "../../../../shared/ui/icons";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import { openProjectView } from "../../model/projectViews";

type LinkKind = "folder" | "file" | "issue" | "document" | "feature" | "decision";
type SessionLink = { kind: LinkKind; target: string; code: string | null; title: string; missing?: boolean };
type Candidate = { id: number; code: string | null; title: string };

const ICONS: Record<LinkKind, ComponentType<{ className?: string }>> = {
  folder: Folder,
  file: Attachment,
  issue: CheckSquare,
  document: Book,
  feature: Puzzle,
  decision: Scale,
};
const KINDS: LinkKind[] = ["folder", "file", "issue", "document", "feature", "decision"];
/** 以后再做的种类：菜单里灰着占位。 */
const LATER = [
  { id: "session", icon: MessageSquare },
  { id: "output", icon: Star },
  { id: "asset", icon: Book },
] as const;

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

type Props = { sessionId: string; cwd: string; onOpenFile: (path: string) => void };

/** 关联按钮（带数量角标），放在输入框顶栏、分支后面。 */
export function SessionLinksButton({ sessionId, cwd, onOpenFile }: Props) {
  const { t } = useTranslation("soloyard");
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { data: links } = useSoloyard<SessionLink[]>("sessionLinks", sessionId);
  const count = links?.length ?? 0;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-no-drag
        data-soloyard-links-trigger
        title={t("links.title")}
        aria-label={t("links.title")}
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`relative grid size-6 shrink-0 place-items-center rounded text-content/60 hover:bg-content/10 hover:text-content ${open ? "bg-content/10 text-content" : ""}`}
      >
        <Link className="size-3.5" />
        {count ? (
          <span className="absolute -top-1 -right-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-content px-0.5 text-[9.5px] font-semibold text-background-base">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          gap={6}
          width={340}
          maxHeight={480}
          ignore="[data-soloyard-links-trigger]"
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label={t("links.title")}
          className="overflow-y-auto p-1.5 text-content"
        >
          <LinksPanel sessionId={sessionId} cwd={cwd} links={links ?? []} onOpenFile={onOpenFile} onClose={() => setOpen(false)} />
        </Popover>
      ) : null}
    </>
  );
}

function LinksPanel({ sessionId, cwd, links, onOpenFile, onClose }: Props & { links: SessionLink[]; onClose: () => void }) {
  const { t } = useTranslation("soloyard");
  const [mode, setMode] = useState<"list" | "kinds" | LinkKind>("list");
  const { data: project } = useSoloyard<SoloyardProject | null>("findProjectByPath", cwd);
  const link = (kind: LinkKind, target: string) => mutateSoloyard("linkSession", sessionId, kind, target);

  const add = async (kind: LinkKind) => {
    if (kind === "folder" || kind === "file") {
      const paths = kind === "folder" ? await pickFolders(t("links.pickFolders")) : ((await pickFiles(t("links.pickFiles"))) ?? []);
      for (const path of paths) if (path !== cwd) await link(kind, path);
      setMode("list");
    } else setMode(kind);
  };

  const openLink = (l: SessionLink) => {
    if (l.missing) return;
    if (l.kind === "folder") void revealPath(l.target);
    else if (l.kind === "file") onOpenFile(l.target);
    else if (l.kind === "issue") openProjectView({ cwd, view: "issue", itemId: l.target, title: `${l.code} ${l.title}` });
    else return; // 文档 / 功能 / 决策还没有详情页
    onClose();
  };

  if (mode === "kinds")
    return (
      <div className="flex flex-col">
        <PanelTitle onBack={() => setMode("list")}>{t("links.add")}</PanelTitle>
        {KINDS.map((kind) => {
          const Icon = ICONS[kind];
          const needsProject = kind !== "folder" && kind !== "file";
          return (
            <Row key={kind} disabled={needsProject && !project} onClick={() => void add(kind)}>
              <Icon className="size-3.5 shrink-0 text-content/60" />
              <span className="flex-1">{t(`links.kind.${kind}`)}</span>
            </Row>
          );
        })}
        <div className="mx-1 my-1 h-px bg-stroke" />
        {LATER.map(({ id, icon: Icon }) => (
          <Row key={id} disabled>
            <Icon className="size-3.5 shrink-0" />
            <span className="flex-1">{t(`links.kind.${id}`)}</span>
            <span className="text-[11px]">{t("links.later")}</span>
          </Row>
        ))}
        {!project ? <p className="px-2 pt-1.5 pb-1 text-[11px] text-content/40">{t("links.noProject")}</p> : null}
      </div>
    );

  if (mode !== "list")
    return (
      <CandidatePicker
        kind={mode}
        projectId={project?.id}
        linked={new Set(links.filter((l) => l.kind === mode).map((l) => l.target))}
        onBack={() => setMode("kinds")}
        onPick={async (id) => {
          await link(mode, String(id));
          setMode("list");
        }}
      />
    );

  const groups = KINDS.map((kind) => ({ kind, items: links.filter((l) => l.kind === kind) })).filter(
    (g) => g.items.length || g.kind === "folder",
  );
  return (
    <div className="flex flex-col">
      <PanelTitle>{t("links.count", { count: links.length })}</PanelTitle>
      {groups.map(({ kind, items }) => {
        const Icon = ICONS[kind];
        return (
          <div key={kind} className="flex flex-col">
            <div className="px-2 pt-2 pb-0.5 text-[11px] text-content/40">{t(`links.kind.${kind}`)}</div>
            {kind === "folder" ? (
              <Row title={cwd}>
                <Icon className="size-3.5 shrink-0 text-content/60" />
                <span className="min-w-0 flex-1 truncate">{basename(cwd)}</span>
                <span className="text-[11px] text-content/40">{t("links.primary")}</span>
              </Row>
            ) : null}
            {items.map((l) => (
              <Row key={l.target} title={l.kind === "folder" || l.kind === "file" ? l.target : undefined} onClick={() => openLink(l)} className="group">
                <Icon className="size-3.5 shrink-0 text-content/60" />
                {l.code ? <span className="shrink-0 font-mono text-[11px] text-content/45">{l.code}</span> : null}
                <span className={`min-w-0 flex-1 truncate ${l.missing ? "text-content/40 line-through" : ""}`}>{l.title}</span>
                {l.missing ? <span className="text-[11px] text-content/40 group-hover:hidden">{t("links.missing")}</span> : null}
                <button
                  type="button"
                  title={t("links.remove")}
                  aria-label={t("links.remove")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void mutateSoloyard("unlinkSession", sessionId, l.kind, l.target);
                  }}
                  className="hidden size-5 shrink-0 place-items-center rounded text-content/50 group-hover:grid hover:bg-content/10 hover:text-content"
                >
                  <X className="size-3" />
                </button>
              </Row>
            ))}
          </div>
        );
      })}
      <p className="px-2 pt-2 text-[11.5px] text-content/45">{t(links.length ? "links.hint" : "links.empty")}</p>
      <div className="mx-1 my-1 h-px bg-stroke" />
      <Row onClick={() => setMode("kinds")}>
        <Plus className="size-3.5 shrink-0 text-content/60" />
        <span className="flex-1 text-content/80">{t("links.add")}</span>
      </Row>
    </div>
  );
}

function CandidatePicker({
  kind,
  projectId,
  linked,
  onBack,
  onPick,
}: {
  kind: LinkKind;
  projectId?: number;
  linked: Set<string>;
  onBack: () => void;
  onPick: (id: number) => void;
}) {
  const { t } = useTranslation("soloyard");
  const [q, setQ] = useState("");
  const { data: candidates } = useSoloyard<Candidate[]>("linkCandidates", projectId, kind, q);
  return (
    <div className="flex flex-col">
      <PanelTitle onBack={onBack}>{t(`links.kind.${kind}`)}</PanelTitle>
      <label className="mx-1 mb-1 flex h-7 items-center gap-1.5 rounded-md border border-stroke px-2">
        <Search className="size-3.5 text-content/40" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("links.search")}
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-content/35"
        />
      </label>
      {candidates?.map((c) => {
        const already = linked.has(String(c.id));
        return (
          <Row key={c.id} disabled={already} onClick={() => onPick(c.id)}>
            {c.code ? <span className="shrink-0 font-mono text-[11px] text-content/45">{c.code}</span> : null}
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {already ? <span className="text-[11px]">{t("links.linked")}</span> : null}
          </Row>
        );
      })}
      {candidates && candidates.length === 0 ? <p className="px-2 py-1.5 text-[11.5px] text-content/45">{t("links.noMatches")}</p> : null}
    </div>
  );
}

function PanelTitle({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const { t } = useTranslation("soloyard");
  return (
    <div className="flex items-center gap-1 px-2 pt-1 pb-1.5 text-[12px] text-content/60">
      {onBack ? (
        <button type="button" onClick={onBack} title={t("links.back")} aria-label={t("links.back")} className="-ml-1 grid size-5 place-items-center rounded hover:bg-content/10">
          <ArrowLeft className="size-3.5" />
        </button>
      ) : null}
      {children}
    </div>
  );
}

function Row({
  children,
  onClick,
  disabled,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const interactive = onClick && !disabled;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={title}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? (e) => e.key === "Enter" && onClick() : undefined}
      className={`flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] ${disabled ? "text-content/35" : ""} ${interactive ? "cursor-default hover:bg-content/10" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
