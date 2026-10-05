/**
 * Soloyard：多仓库项目在侧栏里的样子。
 * - 项目行尾的「N 个仓库」、选中项目下面的根目录 / 各仓库行（带会话数，点一下只看它的会话）——挂在 ProjectRail；
 * - 会话列表算各仓库的会话数、打开项目时识别仓库并提示设成多仓库项目——挂在 Sidebar。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { pickFolders } from "../../../../platform/tauri/fs";
import { Modal } from "../../../../shared/ui/Modal";
import { Check, Folder, GitBranch, Loader, Plus } from "../../../../shared/ui/icons";
import { mutateSoloyard, useSoloyard } from "../../data/api";
import { requestOpenProject } from "../../model/appActions";
import { publishRepoCounts, setRepoFilter, sessionRepo, useRepoCounts, useRepoFilter, type RepoFilter } from "../../model/repoFilter";
import { useProjectRepos, type RepoCandidate } from "../../model/repos";

/** 项目行尾：这个项目由几个仓库组成。 */
export function RepoCountBadge({ path }: { path: string }) {
  const { t } = useTranslation("soloyard");
  const count = useProjectRepos(path)?.repos?.length;
  return count ? <span className="shrink-0 text-[11px] text-content/40">{t("repos.count", { count })}</span> : null;
}

/** 选中的多仓库项目下面：根目录和各成员仓库，右边是会话数；点一下筛会话列表，再点取消。 */
export function RepoRailChildren({ cwd }: { cwd: string }) {
  const { t } = useTranslation("soloyard");
  const info = useProjectRepos(cwd);
  const filter = useRepoFilter(cwd);
  const counts = useRepoCounts(cwd);
  if (!info?.repos?.length) return null;
  const rows: { value: RepoFilter; label: string; root?: boolean }[] = [
    { value: "root", label: t("repos.chips.root"), root: true },
    ...info.repos.filter((r) => !r.missing).map((r) => ({ value: r.path, label: r.name })),
  ];
  return (
    <div className="flex flex-col gap-px pb-1">
      {rows.map((row) => {
        const on = filter === row.value;
        const Icon = row.root ? Folder : GitBranch;
        const count = counts.get(row.value) ?? 0;
        return (
          <button
            key={row.value}
            type="button"
            data-no-drag
            onClick={() => setRepoFilter(cwd, on ? null : row.value)}
            className={`flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-8 text-left text-[12.5px] ${on ? "bg-selection text-content" : "text-content/55 hover:bg-content/8 hover:text-content"}`}
          >
            <Icon className="size-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {count ? <span className="shrink-0 text-[11px] text-content/40">{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 会话列表里算各仓库的会话数，交给侧栏的仓库行显示（不渲染东西）。 */
export function RepoCountsPublisher({ cwd, sessions }: { cwd: string; sessions: readonly { worktreeCwd?: string }[] }) {
  const info = useProjectRepos(cwd);
  useEffect(() => {
    if (!info?.repos?.length) return;
    const counts = new Map<RepoFilter, number>();
    for (const s of sessions) {
      const repo = sessionRepo(info, s);
      counts.set(repo, (counts.get(repo) ?? 0) + 1);
    }
    publishRepoCounts(cwd, counts);
  }, [cwd, info, sessions]);
  return null;
}

/** 成员仓库变了（加入 / 移出）就调一次：列会话时才会把成员仓库里的会话收到根项目下。 */
export function useOnRepoMembersChanged(cwd: string | undefined, onChange: () => void) {
  const members = useProjectRepos(cwd)?.repos?.map((r) => r.path).join("\n");
  const last = useRef<string | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (members === undefined) return;
    if (last.current !== undefined && last.current !== members) latest.current();
    last.current = members;
  }, [members]);
}

type Suggestion = { kind: "root" | "parent"; root: string; current?: string; repos: RepoCandidate[] };
const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;
const clean = (path: string) => path.replace(/\/+$/, "");
/** 自动弹过一次就不再自动弹（关掉后留着提示条）；点「以后再说」连提示条也不显示。 */
const seenKey = (cwd: string) => `soloyard.repoSetup.seen:${clean(cwd)}`;
const dismissKey = (cwd: string) => `soloyard.repoSetup.dismissed:${clean(cwd)}`;

/**
 * 打开项目时识别仓库：普通文件夹下有 git 仓库（openroboto），或者单个仓库的上级目录里还有别的仓库
 * （hackquest-api-v2）——第一次自动弹窗让用户勾选，关掉后会话列表顶上留一条提示。
 */
export function RepoSetupPrompt({ cwd }: { cwd: string }) {
  const { t } = useTranslation("soloyard");
  const { data: suggestion } = useSoloyard<Suggestion | null>("setupSuggestion", cwd);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey(cwd)) === "1");
  const [open, setOpen] = useState(false);
  useEffect(() => setDismissed(localStorage.getItem(dismissKey(cwd)) === "1"), [cwd]);
  useEffect(() => {
    if (!suggestion || localStorage.getItem(seenKey(cwd)) === "1" || localStorage.getItem(dismissKey(cwd)) === "1") return;
    localStorage.setItem(seenKey(cwd), "1");
    setOpen(true);
  }, [cwd, suggestion]);
  if (!suggestion || dismissed) return null;
  const name = basename(suggestion.root);
  const others = suggestion.repos.filter((r) => r.path !== suggestion.current);
  const text =
    suggestion.kind === "root"
      ? t("repos.setup.banner", { name, count: suggestion.repos.length })
      : t("repos.merge.banner", { parent: name, count: others.length, names: others.map((r) => r.name).join("、") });
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-lg border border-accent/25 bg-accent/8 px-3 py-2.5 text-[12px] text-content/80">
      <p>{text}</p>
      <div className="mt-2 flex gap-1.5">
        <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-content px-2.5 py-1 text-[12px] font-medium text-background-base hover:bg-content/80">
          {suggestion.kind === "root" ? t("repos.setup.action") : t("repos.merge.action", { name })}
        </button>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(dismissKey(cwd), "1");
            setDismissed(true);
          }}
          className="rounded-md px-2.5 py-1 text-[12px] text-content/60 hover:bg-content/8 hover:text-content"
        >
          {t("repos.merge.later")}
        </button>
      </div>
      {open ? <SetupDialog cwd={cwd} suggestion={suggestion} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function SetupDialog({ cwd, suggestion, onClose }: { cwd: string; suggestion: Suggestion; onClose: () => void }) {
  const { t } = useTranslation("soloyard");
  const current = suggestion.current;
  const [picked, setPicked] = useState(() => new Set(suggestion.repos.map((r) => r.path)));
  const [extra, setExtra] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const name = basename(suggestion.root);
  const isRoot = suggestion.kind === "root";
  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const submit = async () => {
    setRunning(true);
    try {
      await mutateSoloyard("mergeIntoParent", current ?? clean(cwd), suggestion.root, [...picked, ...extra]);
      onClose();
      if (!isRoot) requestOpenProject(suggestion.root);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  };
  const row = (path: string, label: string, hint: string, locked?: boolean) => {
    const on = locked || picked.has(path) || extra.includes(path);
    return (
      <button
        key={path}
        type="button"
        disabled={locked || running}
        onClick={() => (extra.includes(path) ? setExtra((x) => x.filter((p) => p !== path)) : toggle(path))}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-content/5 disabled:hover:bg-transparent"
      >
        <span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-white" : "border-content/40"}`}>
          {on ? <Check className="size-3" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[12.5px]">
            {label}
            {locked ? <span className="rounded bg-accent/15 px-1.5 text-[10.5px] text-accent">{t("repos.merge.current")}</span> : null}
          </span>
          <span className="block truncate font-mono text-[11px] text-content/40">{hint}</span>
        </span>
      </button>
    );
  };
  const rel = (path: string) => (path.startsWith(suggestion.root + "/") ? path.slice(suggestion.root.length + 1) : path);
  const count = new Set([...(current ? [current] : []), ...picked, ...extra]).size;
  return (
    <Modal
      title={isRoot ? t("repos.setup.title", { name }) : t("repos.merge.title", { name })}
      description={isRoot ? t("repos.setup.description", { root: suggestion.root, count: suggestion.repos.length }) : t("repos.merge.description", { parent: suggestion.root })}
      size="md"
      onClose={() => !running && onClose()}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex max-h-[50vh] flex-col overflow-y-auto">
          {suggestion.repos.map((r) => row(r.path, r.name, `${rel(r.path)}${r.branch ? ` · ${r.branch}` : ""}`, r.path === current))}
          {extra.map((p) => row(p, basename(p), p))}
        </div>
        <button
          type="button"
          disabled={running}
          onClick={async () => {
            const paths = await pickFolders(t("repos.pickFolders"));
            setExtra((x) => [...x, ...paths.filter((p) => !x.includes(p) && !picked.has(p))]);
          }}
          className="flex h-7 w-fit items-center gap-1 rounded-md px-2 text-[12px] text-content/60 hover:bg-content/8 hover:text-content"
        >
          <Plus className="size-3.5" />
          {t("repos.merge.addOther")}
        </button>
        <p className="text-[11.5px] text-content/50">{isRoot ? t("repos.setup.note") : t("repos.merge.note")}</p>
        {error ? <p role="alert" className="text-[12px] text-red-400/90">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={running} onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40">
            {t("iterations.cancel")}
          </button>
          <button type="button" disabled={running || !count} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40">
            {running ? <Loader className="size-3.5 animate-spin" /> : null}
            {isRoot ? t("repos.setup.confirm", { count }) : t("repos.merge.confirm", { count })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
