/**
 * Soloyard：多仓库项目的输入框顶栏——「在哪干活」（项目根目录 / 某个成员仓库 / 它的工作树 / 新建工作树）
 * 和「项目地图」（会话启动时作为系统提示交给 agent 的内容）。发第一条消息后位置就定了，只显示不能改。
 */
import { useRef, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { Popover } from "../../../../shared/ui/Popover";
import { ArrowLeft, Check, ChevronDown, Folder, FolderTree, GitBranch, Plus } from "../../../../shared/ui/icons";
import { useSoloyard } from "../../data/api";
import { requestSetWorkDir } from "../../model/appActions";
import { openProjectView } from "../../model/projectViews";
import { locateWorkDir, useProjectRepos, type RepoInfo } from "../../model/repos";

type Props = {
  sessionId: string;
  /** 会话的 cwd：项目根目录。 */
  cwd: string;
  /** 实际干活的目录（成员仓库或它的工作树）；不给 = 根目录。 */
  workCwd?: string;
  /** 第一次发送时在 workCwd 这个仓库里新建工作树。 */
  newWorktree: boolean;
  locked: boolean;
};

const chip = "flex h-6 shrink-0 items-center gap-1.5 rounded px-1.5 text-[12px] text-content/60";

export function WorkDirChip({ sessionId, cwd, workCwd, newWorktree, locked }: Props) {
  const { t } = useTranslation("soloyard");
  const info = useProjectRepos(cwd);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!info?.repos?.length) return null;
  const at = locateWorkDir(info, workCwd);
  const label = !at
    ? t("repos.where.root")
    : `${at.repo.name}${at.worktree ? ` · ${at.worktree.name}` : newWorktree ? ` · ${t("repos.where.newWorktree")}` : ""}`;
  const branch = at && !newWorktree ? (at.worktree?.branch ?? at.repo.branch) : null;
  const Icon = at ? GitBranch : Folder;
  if (locked)
    return (
      <span className={chip} title={t("repos.where.locked")}>
        <Icon className="size-3.5" />
        <span className="max-w-56 truncate">{label}</span>
        {branch ? <span className="max-w-40 truncate text-content/40">{branch}</span> : null}
      </span>
    );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-no-drag
        data-soloyard-workdir-trigger
        title={t("repos.where.title")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`${chip} text-content hover:bg-content/10 ${open ? "bg-content/10" : ""}`}
      >
        <Icon className="size-3.5" />
        <span className="max-w-56 truncate">{label}</span>
        {branch ? <span className="max-w-40 truncate text-content/45">{branch}</span> : null}
        <ChevronDown className="size-3 text-content/45" />
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          gap={6}
          width={360}
          maxHeight={460}
          ignore="[data-soloyard-workdir-trigger]"
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label={t("repos.where.title")}
          className="overflow-y-auto p-1.5 text-content"
        >
          <WherePanel
            repos={info.repos}
            root={info.project.root ?? cwd}
            current={at?.repo}
            workCwd={workCwd}
            newWorktree={newWorktree}
            onPick={(request) => {
              setOpen(false);
              void requestSetWorkDir({ sessionId, ...request }).catch(() => undefined);
            }}
          />
        </Popover>
      ) : null}
    </>
  );
}

function WherePanel({
  repos,
  root,
  current,
  workCwd,
  newWorktree,
  onPick,
}: {
  repos: RepoInfo[];
  root: string;
  current?: RepoInfo;
  workCwd?: string;
  newWorktree: boolean;
  onPick: (request: { workCwd?: string; branch?: string; newWorktree?: boolean }) => void;
}) {
  const { t } = useTranslation("soloyard");
  const [repo, setRepo] = useState<RepoInfo>();
  if (repo) {
    const here = current?.id === repo.id;
    return (
      <div className="flex flex-col">
        <Title onBack={() => setRepo(undefined)}>{repo.name}</Title>
        <Option
          title={t("repos.where.direct", { name: repo.name })}
          hint={repo.branch ?? ""}
          on={here && workCwd === repo.path && !newWorktree}
          onClick={() => onPick({ workCwd: repo.path, branch: repo.branch ?? undefined })}
        />
        <Option
          icon={<Plus className="size-3.5" />}
          title={t("repos.where.newWorktree")}
          hint={t("repos.where.newWorktreeHint", { branch: repo.branch ?? "HEAD" })}
          on={here && newWorktree}
          onClick={() => onPick({ workCwd: repo.path, newWorktree: true })}
        />
        {repo.worktrees.length ? (
          <>
            <div className="mx-1 my-1 h-px bg-stroke" />
            <p className="px-2 pt-1 pb-0.5 text-[11px] text-content/45">{t("repos.where.worktrees")}</p>
            {repo.worktrees.map((w) => (
              <Option
                key={w.path}
                title={w.name}
                hint={w.branch ?? ""}
                on={workCwd === w.path}
                onClick={() => onPick({ workCwd: w.path, branch: w.branch ?? undefined })}
              />
            ))}
          </>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <Title>{t("repos.where.title")}</Title>
      <Option
        icon={<Folder className="size-3.5" />}
        title={t("repos.where.root")}
        hint={t("repos.where.rootHint", { root })}
        on={!current && !workCwd}
        onClick={() => onPick({})}
      />
      <div className="mx-1 my-1 h-px bg-stroke" />
      <p className="px-2 pt-1 pb-0.5 text-[11px] text-content/45">{t("repos.where.inRepo")}</p>
      {repos
        .filter((r) => !r.missing)
        .map((r) => (
          <Option
            key={r.id}
            icon={<GitBranch className="size-3.5" />}
            title={r.name}
            hint={[r.branch, r.description, r.worktrees.length ? t("repos.worktreeCount", { count: r.worktrees.length }) : ""].filter(Boolean).join(" · ")}
            on={current?.id === r.id}
            more
            onClick={() => setRepo(r)}
          />
        ))}
    </div>
  );
}

/** 「项目地图」按钮：会话启动时作为系统提示交给 agent 的内容（成员仓库 + 项目说明）。没有内容时不显示。 */
export function ProjectMapChip({ cwd, workCwd }: { cwd: string; workCwd?: string }) {
  const { t } = useTranslation("soloyard");
  const { data: map } = useSoloyard<string>("projectMap", cwd, workCwd ?? cwd);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!map) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-no-drag
        data-soloyard-map-trigger
        title={t("repos.map.hint")}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`${chip} hover:bg-content/10 hover:text-content ${open ? "bg-content/10 text-content" : ""}`}
      >
        <FolderTree className="size-3.5" />
        <span>{t("repos.map.title")}</span>
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          gap={6}
          width={480}
          maxHeight={460}
          ignore="[data-soloyard-map-trigger]"
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label={t("repos.map.title")}
          className="flex flex-col p-1.5 text-content"
        >
          <div className="flex items-center gap-2 px-2 pt-1 pb-1.5 text-[12px]">
            <span className="text-content/60">{t("repos.map.hint")}</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openProjectView({ cwd, view: "repos", title: t("view.repos") });
              }}
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-content/70 hover:bg-content/10 hover:text-content"
            >
              {t("repos.map.edit")}
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-content/70">{map}</pre>
        </Popover>
      ) : null}
    </>
  );
}

function Title({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
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

function Option({ icon, title, hint, on, more, onClick }: { icon?: React.ReactNode; title: string; hint?: string; on?: boolean; more?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-content/10 ${on ? "bg-content/5" : ""}`}
    >
      {icon ? <span className="mt-0.5 shrink-0 text-content/55">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px]">{title}</span>
        {hint ? <span className="block truncate text-[11px] text-content/45">{hint}</span> : null}
      </span>
      {on ? <Check className="mt-0.5 size-3.5 shrink-0 text-accent" /> : more ? <ChevronDown className="mt-0.5 size-3 shrink-0 -rotate-90 text-content/40" /> : null}
    </button>
  );
}
