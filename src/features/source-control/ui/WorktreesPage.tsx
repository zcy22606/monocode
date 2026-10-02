import { useMemo, useState } from "react";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import {
  FolderOpen,
  FolderTree,
  GitBranch,
  Loader,
  Plus,
  RefreshCw,
  Trash2,
} from "../../../shared/ui/icons";
import { revealPath } from "../../../platform/tauri/fs";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { isEqualOrInside, pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { loadArchivedProjects, type RecentProject } from "../../projects/model/recents";
import type { Session } from "../../sessions/model/session";
import {
  checkWorktreeRemoval,
  worktreeSessionIds,
  type RemoveWorktree,
  type Worktree,
} from "../model/worktrees";
import { useTranslation } from "../../../i18n";

export function WorktreesPage({
  cwd,
  recents = [],
  liveSessions = [],
  onRemove,
  onCheckRemove = checkWorktreeRemoval,
  onDeleteSessions,
}: {
  cwd: string;
  recents?: RecentProject[];
  liveSessions?: Session[];
  onRemove: RemoveWorktree;
  onCheckRemove?: RemoveWorktree;
  onDeleteSessions?: (sessionIds: readonly string[]) => Promise<boolean>;
}) {
  const { t } = useTranslation("sourceControl");
  const projects = useMemo(() => {
    const choices: RecentProject[] = [];
    const seen = new Set<string>();
    const add = (choice: RecentProject) => {
      if (!choice.path || choice.path === "~") return;
      const key = pathKey(choice.path);
      if (seen.has(key)) return;
      seen.add(key);
      choices.push(choice);
    };
    add({ path: cwd, openedAt: Number.MAX_SAFE_INTEGER });
    recents.forEach(add);
    loadArchivedProjects().forEach((item) =>
      add({ path: item.path, openedAt: item.archivedAt }),
    );
    return choices;
  }, [cwd, recents]);
  const [project, setProject] = useState(
    cwd === "~" ? (projects[0]?.path ?? "") : cwd,
  );
  const { data, error: loadError, refresh } = useProjectWorktrees(project);
  const worktrees = data?.worktrees.filter((tree) => !tree.isMain) ?? [];
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Worktree>();
  const [refreshingAfterFailure, setRefreshingAfterFailure] = useState(false);
  return (
    <div
      data-setting-id="project-worktrees"
      id="setting-project-worktrees"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-1">
        <SearchableProjectPicker
          cwd={project || "~"}
          recents={projects}
          className="w-fit max-w-full shrink-0"
          buttonClassName="h-7.5 max-w-full gap-2 bg-content/5 px-2.5 text-[13px] hover:bg-content/12 active:scale-[0.98]"
          onSelectProject={(path) => {
            setProject(path);
            setError(undefined);
            setDeleting(undefined);
          }}
        />
        <button
          type="button"
          disabled={!data}
          onClick={() => setCreating(true)}
          className="flex h-7.5 items-center gap-1.5 rounded-md px-2 text-[11px] hover:bg-content/12 disabled:opacity-40 active:scale-[0.97]"
        >
          <Plus className="size-3" />
          {t("createWorktree.submit")}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[12px] text-content/50">
          {t("worktrees.description")}
        </p>
        <button
          type="button"
          title={
            loadError
              ? t("worktrees.refreshFailed", { error: loadError })
              : t("worktrees.refresh")
          }
          aria-label={t("worktrees.refresh")}
          disabled={!project}
          onClick={refresh}
          className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-content/8 px-2 text-[11px] hover:bg-content/12 disabled:opacity-40 active:scale-[0.97] ${loadError ? "text-red-400" : "text-content/65"}`}
        >
          <RefreshCw className="size-3.5" />
          <span>{t("worktrees.refreshButton")}</span>
        </button>
      </div>
      {error && (
        <p role="alert" className="break-words text-[12px] text-red-400">
          {error}
        </p>
      )}
      {!project ? (
        <p className="text-[12px] text-content/50">
          {t("worktrees.noProject")}
        </p>
      ) : !data && loadError ? (
        <p role="alert" className="break-words text-[12px] text-red-400">
          {loadError}
        </p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-[12px] text-content/50">
          <Loader className="size-4 animate-spin" />
          {t("worktrees.loading")}
        </p>
      ) : !worktrees.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-stroke px-4 py-8 text-center">
          <FolderTree className="size-5 text-content/35" />
          <p className="text-[13px] font-medium">{t("worktrees.empty")}</p>
          <p className="text-[12px] text-content/50">
            {t("worktrees.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stroke overflow-hidden rounded-xl border border-stroke">
          {worktrees.map((tree) => {
            const count = worktreeSessionIds(tree, liveSessions).length;
            const blocked = tree.locked
              ? t("worktrees.unlockFirst")
              : !tree.branch
                ? t("worktrees.detachedBlocked")
                : undefined;
            return (
              <div key={tree.path} className="flex items-start gap-3 p-4">
                <FolderTree className="mt-0.5 size-4 shrink-0 text-content/45" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {projectName(tree.path)}
                    </span>
                    {pathKey(tree.path) === pathKey(project) && (
                      <span className="text-[10px] text-content/40">
                        {t("worktrees.selectedProject")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-all text-[11px] text-content/40">
                    {prettyCwd(tree.path)}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-content/55">
                    <GitBranch className="size-3 shrink-0" />
                    <span className="min-w-0 break-all">
                      {tree.branch
                        ? t("worktrees.currentBranch", { branch: tree.branch })
                        : t("worktrees.detachedAt", { sha: tree.head.slice(0, 7) })}
                    </span>
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-content/55">
                    <span>
                      {t("worktrees.sessionCount", { count })}
                    </span>
                    <span className={tree.dirty ? "text-amber-400" : ""}>
                      {tree.missing
                        ? t("worktrees.missing")
                        : tree.dirty == null
                          ? t("worktrees.statusUnavailable")
                          : tree.dirty
                            ? t("worktrees.dirty")
                            : t("worktrees.clean")}
                    </span>
                    {!!tree.unpushed && (
                      <span>
                        {t("worktrees.unpublished", { count: tree.unpushed })}
                      </span>
                    )}
                    {tree.locked && <span>{t("worktrees.locked")}</span>}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={tree.missing}
                  aria-label={t("worktrees.reveal", { name: tree.branch ?? t("worktrees.worktree") })}
                  title={t("worktrees.revealFolder")}
                  onClick={() =>
                    void revealPath(tree.path).catch((e) => setError(String(e)))
                  }
                  className="rounded-md p-1.5 text-content/40 hover:bg-content/8 hover:text-content disabled:opacity-30"
                >
                  <FolderOpen className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={!!blocked || refreshingAfterFailure || !!loadError}
                  aria-label={t("worktrees.delete", { name: tree.branch ?? t("worktrees.worktree") })}
                  title={blocked ?? t("deleteWorktree.submit")}
                  onClick={() => {
                    setError(undefined);
                    setDeleting(tree);
                  }}
                  className="rounded-md p-1.5 text-content/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-25"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {data && (
        <p className="break-all text-[11px] text-content/40">
          {t("worktrees.defaultRoot", { path: prettyCwd(data.defaultRoot) })}
        </p>
      )}
      {creating && (
        <CreateWorktreeDialog
          cwd={project}
          baseCwd={project}
          defaultRoot={data?.defaultRoot}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {deleting && (
        <DeleteWorktreeDialog
          cwd={project}
          tree={deleting}
          sessionCount={worktreeSessionIds(deleting, liveSessions).length}
          onRemove={async (cwd, path, force, deleteSessions) => {
            // Check predictable blockers before any conversation is destroyed.
            await onCheckRemove(cwd, path, force);
            const sessionIds = worktreeSessionIds(deleting, liveSessions);
            let sessionsDeleted = false;
            try {
              if (sessionIds.length && deleteSessions) {
                if (!onDeleteSessions) {
                  throw new Error(
                    t("worktrees.sessionsInUse"),
                  );
                }
                if (!(await onDeleteSessions(sessionIds))) {
                  throw new Error(
                    t("worktrees.sessionsNotDeleted"),
                  );
                }
                sessionsDeleted = true;
              }
              await onRemove(cwd, path, force, !deleteSessions);
            } catch (error) {
              const failure = sessionsDeleted
                ? new Error(
                    t("worktrees.partialDelete", { error: String(error) }),
                  )
                : error;
              // A partial deletion invalidates the dialog's saved session IDs.
              // Require a fresh listing before another destructive attempt.
              setDeleting(undefined);
              setError(String(failure));
              setRefreshingAfterFailure(true);
              await refresh();
              setRefreshingAfterFailure(false);
              throw failure;
            }
          }}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            if (isEqualOrInside(project, deleting.path)) {
              const main = data?.worktrees.find((tree) => tree.isMain);
              if (main) setProject(main.path);
            }
            setDeleting(undefined);
            refresh();
          }}
        />
      )}
    </div>
  );
}
