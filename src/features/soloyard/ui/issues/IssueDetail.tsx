import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import { ExplorerMenu } from "../../../files/ui/ExplorerMenu";
import { AgentMarkdown } from "../../../sessions/ui/AgentMarkdown";
import { MessageSquare, Play, Plus, X } from "../../../../shared/ui/icons";
import { mutateSoloyard, useProjectForPath, useSoloyard } from "../../data/api";
import { requestOpenSession, requestSendToSession, requestStartWork } from "../../model/appActions";
import { startWorkPrompt } from "../../model/startWork";
import { PRIORITIES, STATUSES, priorityLabel, statusLabel, type IssueDetail as Detail } from "../../model/issues";
import { PriorityIcon, StatusIcon } from "./IssueIcons";

const when = (iso: string, lang: string) => new Date(iso).toLocaleString(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

type Picker = { anchor: HTMLElement; kind: "status" | "priority" };

/** Issue 详情标签：标题、属性、描述、验收清单、关联会话、评论。 */
export function IssueDetail({ issueId, cwd }: { issueId: number; cwd: string }) {
  const { t, i18n } = useTranslation("soloyard");
  const actorName = (actor: string) => (actor === "user" ? t("detail.you") : actor.replace(/^agent:/, ""));
  const { data: issue, error } = useSoloyard<Detail | null>("getIssue", issueId);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [editingBody, setEditingBody] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const { data: project } = useProjectForPath(cwd);
  if (error) return <p className="p-6 text-[12px] text-red-400">{error}</p>;
  if (issue === null) return <p className="p-6 text-[13px] text-content/50">{t("detail.deleted")}</p>;
  if (!issue) return null;
  const update = (patch: Record<string, unknown>) => mutateSoloyard("updateIssue", issue.id, patch);
  // 开工：先生成会话 id 挂到 issue 上，再请底座开新会话、把开工提示词填进输入框。
  // 不在这里改状态——用户可能只是看看就关了；真正开工后 agent 按提示词经 MCP 改成 in_progress。
  // 会话第一次发送后才存进库，没发出去的关联在列表里不显示。
  const startWork = async () => {
    const sessionId = crypto.randomUUID();
    await mutateSoloyard("linkSession", sessionId, "issue", String(issue.id));
    requestStartWork({ cwd, sessionId, prompt: startWorkPrompt(issue, project ?? { name: cwd }, cwd) });
  };
  const sessions = issue.sessions.filter((s) => !s.missing); // 没发出去就关掉的会话不显示
  const latestSession = sessions[0];
  // 打回：原因记成评论，退回进行中，并发给最近的那个会话让 agent 接着改
  const sendBack = async (reason: string) => {
    await mutateSoloyard("addComment", issue.id, t("prompt.sentBackComment", { reason }));
    await update({ status: "in_progress" });
    if (latestSession) {
      requestSendToSession({ sessionId: latestSession.id, text: t("prompt.sentBackMessage", { ident: issue.ident, reason }) });
    }
    setSendingBack(false);
  };

  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
        <header className="flex flex-col gap-2">
          <span className="font-mono text-[12px] text-content/40">{issue.ident}</span>
          <input
            key={issue.version}
            defaultValue={issue.title}
            aria-label={t("detail.titleAria")}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== issue.title && update({ title: e.target.value.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-full bg-transparent text-[20px] font-medium text-content outline-none"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void startWork()}
              title={t("detail.startWorkHint")}
              className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:opacity-90"
            >
              <Play className="size-3" />
              {t("detail.startWork")}
            </button>
            <PropertyButton onClick={(el) => setPicker({ anchor: el, kind: "status" })}>
              <StatusIcon status={issue.status} />
              {statusLabel(issue.status)}
            </PropertyButton>
            <PropertyButton onClick={(el) => setPicker({ anchor: el, kind: "priority" })}>
              <PriorityIcon priority={issue.priority} />
              {priorityLabel(issue.priority)}
            </PropertyButton>
            <Labels labels={issue.labels} onChange={(labels) => update({ labels })} />
          </div>
        </header>

        {issue.status === "in_review" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-sky-400/40 bg-sky-400/5 p-3">
            <div className="flex items-center gap-2 text-[13px] text-content">
              <StatusIcon status="in_review" />
              {t("detail.review")}
              <span className="ml-auto flex gap-1.5">
                <button type="button" onClick={() => void update({ status: "done" })} className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:opacity-90">
                  {t("detail.accept")}
                </button>
                <button type="button" onClick={() => setSendingBack(true)} className="h-7 rounded-md border border-stroke px-2.5 text-[12px] text-content/80 hover:bg-content/10">
                  {t("detail.sendBack")}
                </button>
              </span>
            </div>
            {sendingBack ? (
              <SendBack
                target={latestSession ? (latestSession.title ?? t("detail.latestSession")) : null}
                onCancel={() => setSendingBack(false)}
                onSend={sendBack}
              />
            ) : null}
          </div>
        ) : null}

        <Section title={t("detail.description")} action={!editingBody ? <TextButton onClick={() => setEditingBody(true)}>{t("detail.edit")}</TextButton> : null}>
          {editingBody ? (
            <textarea
              autoFocus
              defaultValue={issue.body_md}
              rows={Math.max(6, issue.body_md.split("\n").length + 1)}
              onBlur={(e) => {
                setEditingBody(false);
                if (e.target.value !== issue.body_md) void update({ body_md: e.target.value });
              }}
              placeholder={t("detail.markdownHint")}
              className="w-full resize-y rounded-md border border-stroke bg-content/5 p-3 font-mono text-[12px] leading-relaxed text-content outline-none"
            />
          ) : issue.body_md ? (
            <AgentMarkdown text={issue.body_md} streaming={false} cwd={cwd} />
          ) : (
            <button type="button" onClick={() => setEditingBody(true)} className="text-left text-[13px] text-content/40 hover:text-content/70">
              {t("detail.addDescription")}
            </button>
          )}
        </Section>

        <Section title={`${t("detail.acceptance")}${issue.acceptance.length ? ` · ${issue.acceptance.filter((a) => a.done).length}/${issue.acceptance.length}` : ""}`}>
          <ul className="flex flex-col">
            {issue.acceptance.map((item) => (
              <li key={item.id} className="group flex h-8 items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={!!item.done}
                  aria-label={item.text}
                  onChange={(e) => void mutateSoloyard("updateAcceptance", item.id, { done: e.target.checked ? 1 : 0 })}
                  className="accent-[var(--color-accent)]"
                />
                <span className={`flex-1 ${item.done ? "text-content/40 line-through" : "text-content/90"}`}>{item.text}</span>
                <button type="button" aria-label={t("detail.remove", { text: item.text })} onClick={() => void mutateSoloyard("removeAcceptance", item.id)} className="rounded p-0.5 text-content/40 opacity-0 hover:text-content group-hover:opacity-100">
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <AddLine placeholder={t("detail.addCriterion")} onAdd={(text) => mutateSoloyard("addAcceptance", issue.id, text)} />
        </Section>

        <Section title={t("detail.sessions")}>
          {sessions.length ? (
            <ul className="flex flex-col">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={s.missing}
                    onClick={() => requestOpenSession(s.id)}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-[13px] text-content/80 hover:bg-content/5 disabled:cursor-default disabled:text-content/40 disabled:hover:bg-transparent"
                  >
                    <MessageSquare className="size-3.5 text-content/40" />
                    <span className="flex-1 truncate">{s.missing ? t("detail.deletedSession") : (s.title ?? s.id)}</span>
                    {s.harness ? <span className="text-[11px] text-content/40">{s.harness}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-content/40">{t("detail.noSessions")}</p>
          )}
        </Section>

        <Section title={t("detail.comments")}>
          <ul className="flex flex-col gap-3">
            {issue.comments.map((c) => (
              <li key={c.id} className="rounded-md border border-stroke p-3">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-content/50">
                  <span className="font-medium text-content/80">{actorName(c.actor)}</span>
                  {when(c.created_at, i18n.language)}
                </div>
                <AgentMarkdown text={c.body_md} streaming={false} cwd={cwd} />
              </li>
            ))}
          </ul>
          <CommentBox onSend={(body) => mutateSoloyard("addComment", issue.id, body)} />
        </Section>
      </article>
      {picker ? (
        <ExplorerMenu
          anchor={picker.anchor}
          items={
            picker.kind === "status"
              ? STATUSES.map((s) => ({ kind: "item" as const, id: s, label: statusLabel(s), checked: issue.status === s }))
              : PRIORITIES.map((p) => ({ kind: "item" as const, id: String(p), label: priorityLabel(p), checked: issue.priority === p }))
          }
          ariaLabel={picker.kind === "status" ? t("issues.changeStatus") : t("issues.changePriority")}
          width={180}
          onPick={(id) => {
            setPicker(null);
            void update(picker.kind === "status" ? { status: id } : { priority: Number(id) });
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center text-[11px] font-medium uppercase tracking-wide text-content/40">
        {title}
        <span className="ml-auto normal-case tracking-normal">{action}</span>
      </div>
      {children}
    </section>
  );
}

function PropertyButton({ onClick, children }: { onClick: (el: HTMLElement) => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={(e) => onClick(e.currentTarget)} className="flex h-7 items-center gap-1.5 rounded-md border border-stroke px-2 text-[12px] text-content/80 hover:bg-content/10">
      {children}
    </button>
  );
}

const TextButton = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="text-[12px] text-content/50 hover:text-content">{children}</button>
);

function Labels({ labels, onChange }: { labels: string[]; onChange: (labels: string[]) => void }) {
  const { t } = useTranslation("soloyard");
  const [adding, setAdding] = useState(false);
  return (
    <>
      {labels.map((label) => (
        <span key={label} className="flex h-7 items-center gap-1 rounded-md border border-stroke pl-2 pr-1 text-[12px] text-content/70">
          {label}
          <button type="button" aria-label={t("detail.removeLabel", { label })} onClick={() => onChange(labels.filter((l) => l !== label))} className="rounded p-0.5 text-content/40 hover:text-content">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          placeholder={t("detail.label")}
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            const value = e.currentTarget.value.trim();
            if (e.key === "Escape") setAdding(false);
            if (e.key === "Enter" && value) {
              onChange([...new Set([...labels, value])]);
              setAdding(false);
            }
          }}
          className="h-7 w-28 rounded-md border border-stroke bg-transparent px-2 text-[12px] text-content outline-none"
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-content/50 hover:bg-content/10 hover:text-content">
          <Plus className="size-3" />
          {t("detail.label")}
        </button>
      )}
    </>
  );
}

function AddLine({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={async (e) => {
        if (e.key === "Enter" && text.trim()) {
          await onAdd(text.trim());
          setText("");
        }
      }}
      className="h-8 w-full bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
    />
  );
}

function CommentBox({ onSend }: { onSend: (body: string) => Promise<unknown> }) {
  const { t } = useTranslation("soloyard");
  const [body, setBody] = useState("");
  const send = async () => {
    if (!body.trim()) return;
    await onSend(body.trim());
    setBody("");
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-stroke p-2">
      <textarea
        value={body}
        rows={3}
        placeholder={t("detail.commentPlaceholder")}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.metaKey && void send()}
        className="w-full resize-none bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
      />
      <button type="button" disabled={!body.trim()} onClick={() => void send()} className="self-end rounded-md bg-content/10 px-3 py-1 text-[12px] text-content hover:bg-content/15 disabled:opacity-40">
        {t("detail.comment")}
      </button>
    </div>
  );
}

function SendBack({ target, onCancel, onSend }: { target: string | null; onCancel: () => void; onSend: (reason: string) => Promise<void> }) {
  const { t } = useTranslation("soloyard");
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus
        rows={2}
        value={reason}
        placeholder={t("detail.sendBackPlaceholder")}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="w-full resize-none rounded-md border border-stroke bg-background-base p-2 text-[13px] text-content outline-none placeholder:text-content/40"
      />
      <div className="flex items-center gap-2 text-[11px] text-content/50">
        {target ? t("detail.sendBackTo", { target }) : t("detail.sendBackNoSession")}
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={onCancel} className="h-7 rounded-md px-2.5 text-[12px] text-content/60 hover:text-content">{t("detail.cancel")}</button>
          <button type="button" disabled={!reason.trim()} onClick={() => void onSend(reason.trim())} className="h-7 rounded-md bg-content/10 px-2.5 text-[12px] text-content hover:bg-content/15 disabled:opacity-40">
            {t("detail.sendBack")}
          </button>
        </span>
      </div>
    </div>
  );
}
