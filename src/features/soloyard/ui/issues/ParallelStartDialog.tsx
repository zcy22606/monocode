/**
 * Soloyard：主 issue 的「并行开工」对话框。勾选可开工的子任务（前置没做完的、已经开始的不能选），
 * 每个各开一个会话直接开工；可选在项目根目录再开一个主会话协调和联调（见 model/parallelStart.ts）。
 */
import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import { Modal } from "../../../../shared/ui/Modal";
import { Check, GitBranch, Loader } from "../../../../shared/ui/icons";
import { mutateSoloyard, soloyardCall } from "../../data/api";
import { requestStartWork } from "../../model/appActions";
import { repoName, type IssueDetail } from "../../model/issues";
import { canStart, leadPrompt, needsHuman, startsByDefault, type SubIssue } from "../../model/parallelStart";
import { startWorkPrompt } from "../../model/startWork";
import { StatusIcon } from "./IssueIcons";

type Props = { issue: IssueDetail; project: { name: string; goal?: string }; cwd: string; onClose: () => void };

export function ParallelStartDialog({ issue, project, cwd, onClose }: Props) {
  const { t } = useTranslation("soloyard");
  const [picked, setPicked] = useState(() => new Set(issue.children.filter(startsByDefault).map((c) => c.id)));
  const [lead, setLead] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const reason = (c: SubIssue) =>
    c.status === "done" || c.status === "canceled"
      ? t("detail.parallelDone")
      : c.status !== "backlog" && c.status !== "todo"
        ? t("detail.parallelStarted")
        : needsHuman(c)
          ? t("detail.parallelHuman")
          : t("detail.parallelNotReady");

  const start = async () => {
    setRunning(true);
    try {
      const chosen = issue.children.filter((c) => picked.has(c.id));
      // 子任务：各自的会话挂到 issue 上，在它的仓库里新建工作树，提示词直接发出
      for (const child of chosen) {
        const detail = await soloyardCall<IssueDetail>("getIssue", child.id);
        const sessionId = crypto.randomUUID();
        await mutateSoloyard("linkSession", sessionId, "issue", String(child.id));
        const repo = child.repo_path ?? undefined;
        requestStartWork({ cwd, sessionId, prompt: startWorkPrompt(detail, project, cwd), workCwd: repo, newWorktree: !!repo, send: true });
      }
      // 主会话最后开，开完停在它的标签上
      if (lead) {
        const sessionId = crypto.randomUUID();
        await mutateSoloyard("linkSession", sessionId, "issue", String(issue.id));
        requestStartWork({ cwd, sessionId, prompt: leadPrompt(issue, chosen, project, cwd), send: true });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  };

  const count = picked.size + (lead ? 1 : 0);
  return (
    <Modal title={t("detail.parallelTitle", { ident: issue.ident })} description={t("detail.parallelDescription")} size="md" onClose={() => !running && onClose()}>
      <div className="flex flex-col gap-3 p-4">
        <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
          {issue.children.map((child) => {
            const ready = canStart(child);
            const on = picked.has(child.id);
            return (
              <li key={child.id}>
                <button
                  type="button"
                  disabled={!ready || running}
                  onClick={() => toggle(child.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-content/5 disabled:opacity-55 disabled:hover:bg-transparent"
                >
                  <span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-white" : "border-content/40"}`}>
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  <StatusIcon status={child.status} />
                  <span className="shrink-0 font-mono text-[12px] text-content/45">{child.ident}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{child.title}</span>
                  {ready ? null : <span className="shrink-0 rounded bg-content/10 px-1.5 text-[11px] text-content/55">{reason(child)}</span>}
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-content/50">
                    {child.repo_path ? <><GitBranch className="size-3 opacity-70" />{repoName(child.repo_path)}</> : t("field.noRepo")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <label className="flex items-center gap-2 px-2 text-[12.5px] text-content/80">
          <input type="checkbox" checked={lead} disabled={running} onChange={(e) => setLead(e.target.checked)} className="accent-[var(--color-accent)]" />
          {t("detail.parallelLead")}
        </label>
        {error ? <p role="alert" className="text-[12px] text-red-400/90">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={running} onClick={onClose} className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content disabled:opacity-40">
            {t("iterations.cancel")}
          </button>
          <button
            type="button"
            disabled={running || !picked.size}
            onClick={() => void start()}
            className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            {running ? <Loader className="size-3.5 animate-spin" /> : null}
            {t("detail.parallelConfirm", { count })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
