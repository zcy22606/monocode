/**
 * Soloyard：项目的「仓库」页。根目录、成员仓库（各一句说明）、根目录下还没加入的仓库、项目说明，
 * 点顶栏「项目地图」弹窗预览会话启动时交给 agent 的内容。
 */
import { useEffect, useState } from "react";
import { i18n, useTranslation } from "../../../../i18n";
import { pickTextHarness, runHarnessTextPrompt } from "../../../../integrations/harness";
import { homeDir, pickFolders } from "../../../../platform/tauri/fs";
import { ChevronDown, Folder, FolderTree, GitBranch, Loader, Plus, Sparkles, X } from "../../../../shared/ui/icons";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import { displayPath, useProjectRepos, type RepoCandidate, type RepoInfo } from "../../model/repos";
import { Modal } from "../../../../shared/ui/Modal";
import { isComposing } from "../keys";

export function ReposView({ project, cwd }: { project: SoloyardProject; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const info = useProjectRepos(cwd);
  const { data: candidates } = useSoloyard<RepoCandidate[]>("scanRepos", project.id);
  const { data: map } = useSoloyard<string>("projectMap", cwd, cwd);
  const [home, setHome] = useState<string>();
  const [error, setError] = useState<string>();
  const [drafting, setDrafting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  useEffect(() => void homeDir().then(setHome, () => undefined), []);

  const run = (method: string, ...args: unknown[]) =>
    mutateSoloyard(method, ...args).then(
      () => setError(undefined),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  const addFolders = async () => {
    for (const path of await pickFolders(t("repos.pickFolders"))) await run("addProjectRepo", project.id, path);
  };
  if (!info) return null;
  const root = info.project.root;
  const undescribed = info.repos.filter((r) => !r.description && !r.missing);
  // 每个没写说明的仓库问一次 agent（在那个仓库里跑，读 README 和最近的提交），起草一句说明
  const draft = async () => {
    setDrafting(true);
    const chinese = i18n.language.startsWith("zh");
    await Promise.all(
      undescribed.map(async (repo) => {
        try {
          const text = await runHarnessTextPrompt({
            harness: pickTextHarness(),
            cwd: repo.path,
            timeoutMs: 120_000,
            prompt: `Read this repository's README (and package / build files or the last few commit messages if the README is thin). Reply with ONE line, at most ${chinese ? "30 Chinese characters, in Simplified Chinese" : "15 words, in English"}, saying what the repository is for within its larger project. No quotes, no prefix, nothing else.`,
          });
          const line = text.trim().split("\n").find((l) => l.trim())?.trim().replace(/^["'“「]|["'”」]$/g, "").slice(0, 160);
          if (line) await mutateSoloyard("updateProjectRepo", repo.id, { description: line });
        } catch {
          // 某个仓库起草失败不影响其他的；留空让用户自己写
        }
      }),
    );
    setDrafting(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b border-stroke px-4">
        <h1 className="shrink-0 text-[13px] font-medium text-content">{t("view.repos")}</h1>
        <span className="text-[12px] text-content/40">{info.repos.length}</span>
        <button
          type="button"
          onClick={() => setShowMap(true)}
          className="ml-auto flex h-6 items-center gap-1 rounded px-1.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content"
        >
          <FolderTree className="size-3.5" />
          {t("repos.map.title")}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <p className="max-w-2xl text-[12.5px] text-content/55">{t("repos.intro")}</p>
        {error ? <p className="mt-3 text-[12px] text-red-400">{error}</p> : null}

        <Section title={t("repos.root")}>
          <div className="flex items-center gap-2 rounded-lg border border-stroke px-3 py-2 text-[12.5px]">
            <Folder className="size-3.5 shrink-0 text-content/55" />
            <span className="truncate font-mono text-[12px]">{root ? displayPath(root, null, home) : "—"}</span>
            <span className="shrink-0 rounded bg-content/10 px-1.5 py-0.5 text-[11px] text-content/55">
              {info.project.rootIsRepo ? t("repos.rootIsRepo") : t("repos.rootNotRepo")}
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] text-content/45">{t("repos.rootHint")}</p>
        </Section>

        <Section
          title={t("repos.members")}
          count={info.repos.length}
          action={
            <span className="flex items-center gap-1">
              {undescribed.length || drafting ? (
                <button
                  type="button"
                  disabled={drafting}
                  title={t("repos.draftHint")}
                  onClick={() => void draft()}
                  className="flex h-6 items-center gap-1 rounded px-1.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content disabled:opacity-60"
                >
                  {drafting ? <Loader className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {drafting ? t("repos.drafting") : t("repos.draft", { count: undescribed.length })}
                </button>
              ) : null}
              <button type="button" onClick={() => void addFolders()} className="flex h-6 items-center gap-1 rounded px-1.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content">
                <Plus className="size-3.5" />
                {t("repos.addFolder")}
              </button>
            </span>
          }
        >
          {info.repos.length ? (
            <div className="flex flex-col gap-1.5">
              {info.repos.map((repo) => (
                <RepoRow key={repo.id} repo={repo} root={root} home={home} onRun={run} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-stroke px-3 py-3 text-[12px] text-content/45">{t("repos.empty")}</p>
          )}
          <p className="mt-1.5 text-[11.5px] text-content/45">{t("repos.worktreeHint")}</p>
        </Section>

        {candidates?.length ? (
          <Section
            title={t("repos.found")}
            count={candidates.length}
            action={
              <button
                type="button"
                onClick={() => void (async () => { for (const c of candidates) await run("addProjectRepo", project.id, c.path); })()}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content"
              >
                {t("repos.addAll")}
              </button>
            }
          >
            <div className="flex flex-col">
              {candidates.map((c) => (
                <div key={c.path} className="group flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] hover:bg-content/5">
                  <GitBranch className="size-3.5 shrink-0 text-content/45" />
                  <span className="shrink-0">{c.name}</span>
                  <span className="truncate font-mono text-[11px] text-content/40">
                    {displayPath(c.path, root, home)}
                    {c.branch ? ` · ${c.branch}` : ""}
                  </span>
                  <button type="button" onClick={() => void run("addProjectRepo", project.id, c.path)} className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content">
                    {t("repos.add")}
                  </button>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title={t("repos.instructions")} hint={t("repos.instructionsHint")}>
          <Instructions key={info.project.id} value={info.project.instructions} onSave={(text) => void run("setProjectInstructions", info.project.id, text)} />
        </Section>
      </div>
      {showMap ? (
        <Modal title={t("repos.map.title")} description={t("repos.map.previewHint")} fitViewport onClose={() => setShowMap(false)}>
          <div className="px-4 pt-2 pb-4">
            {map ? (
              <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-content/70">{map}</pre>
            ) : (
              <p className="text-[12px] text-content/40">{t("repos.map.empty")}</p>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Section({ title, count, hint, action, children }: { title: string; count?: number; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6 max-w-3xl">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[12.5px] font-medium">{title}</h2>
        {count != null ? <span className="text-[12px] text-content/40">{count}</span> : null}
        {hint ? <span className="text-[11.5px] text-content/40">{hint}</span> : null}
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

function RepoRow({ repo, root, home, onRun }: { repo: RepoInfo; root: string | null; home?: string; onRun: (method: string, ...args: unknown[]) => Promise<void> }) {
  const { t } = useTranslation("soloyard");
  const [description, setDescription] = useState(repo.description);
  const [showWorktrees, setShowWorktrees] = useState(false);
  useEffect(() => setDescription(repo.description), [repo.description]);
  const save = () => {
    if (description.trim() !== repo.description) void onRun("updateProjectRepo", repo.id, { description: description.trim() });
  };
  return (
    <div className="rounded-lg border border-stroke">
      <div className="grid grid-cols-[minmax(150px,220px)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className={`truncate text-[12.5px] font-medium ${repo.missing ? "text-content/40 line-through" : ""}`}>{repo.name}</div>
          <div className="truncate font-mono text-[11px] text-content/40">
            {displayPath(repo.path, root, home)}
            {repo.branch ? ` · ${repo.branch}` : ""}
          </div>
        </div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setDescription(repo.description);
          }}
          placeholder={t("repos.descriptionPlaceholder")}
          className="h-7 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-[12.5px] outline-none placeholder:text-content/30 hover:border-stroke focus:border-content/30 focus:bg-background-base"
        />
        <div className="flex items-center gap-1">
          {repo.worktrees.length ? (
            <button type="button" onClick={() => setShowWorktrees((v) => !v)} className="flex h-6 items-center gap-1 rounded px-1.5 text-[11.5px] text-content/50 hover:bg-content/10 hover:text-content">
              {t("repos.worktreeCount", { count: repo.worktrees.length })}
              <ChevronDown className={`size-3 transition-transform ${showWorktrees ? "rotate-180" : ""}`} />
            </button>
          ) : null}
          <button type="button" title={t("repos.remove")} aria-label={t("repos.remove")} onClick={() => void onRun("removeProjectRepo", repo.id)} className="grid size-6 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {showWorktrees ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-4 gap-y-0.5 border-t border-stroke px-3 py-2">
          {repo.worktrees.map((w) => (
            <div key={w.path} className="truncate text-[11.5px] text-content/50" title={w.path}>
              <span className="font-mono text-content/70">{w.name}</span>
              {w.branch ? ` ${w.branch}` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Instructions({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const { t } = useTranslation("soloyard");
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)}
      placeholder={t("repos.instructionsPlaceholder")}
      rows={7}
      className="w-full resize-y rounded-lg border border-stroke bg-transparent px-3 py-2 text-[12.5px] leading-relaxed outline-none placeholder:text-content/30 focus:border-content/30"
    />
  );
}
