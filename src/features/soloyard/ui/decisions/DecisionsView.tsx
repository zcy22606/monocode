/**
 * Decisions 页：等你拍板的在前（单向门在前），已定的在后。决策卡照 product-thinking 的顺序：
 * 背景和证据 → 选项（收益、代价、可逆性）→ AI 推荐 → 反方最强论证 → 你的决定。
 * 单向门不预选，逐项点；双向门可以一键采纳 AI 建议（整批可撤销）。拍过的可以改主意，变更历史里留着上一次。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../../i18n";
import { AgentMarkdown } from "../../../sessions/ui/AgentMarkdown";
import { mutateSoloyard, useSoloyard, type SoloyardProject } from "../../data/api";
import { openProjectView, viewLabel } from "../../model/projectViews";
import type { Decision, Evidence } from "../../model/decisions";

export function DecisionsView({ project, cwd, focus }: { project: SoloyardProject; cwd: string; focus?: string }) {
  const { t } = useTranslation("soloyard");
  const { data: decisions, error } = useSoloyard<Decision[]>("listDecisions", project.id);
  const { data: evidence = [] } = useSoloyard<Evidence[]>("listEvidence", project.id);
  const [adopted, setAdopted] = useState<{ batch: string; count: number } | null>(null);
  const [notice, setNotice] = useState("");
  if (error) return <p className="p-6 text-[12px] text-red-400">{error}</p>;
  if (!decisions) return null;

  const pending = decisions.filter((d) => d.status !== "decided");
  const decided = decisions.filter((d) => d.status === "decided");
  const adoptable = pending.filter((d) => d.door !== "one-way" && d.ai?.option);
  const run = (fn: () => Promise<unknown>) => void fn().catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)));
  const adoptAll = () =>
    run(async () => {
      const res = await mutateSoloyard<{ batch: string; adopted: string[] }>("adoptTwoWay", project.id);
      setAdopted({ batch: res.batch, count: res.adopted.length });
    });

  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        <header className="flex items-center gap-3">
          <h1 className="text-[16px] font-medium text-content">{viewLabel("decisions")}</h1>
          <span className="text-[12px] text-content/45">{t("decisions.counts", { pending: pending.length, decided: decided.length })}</span>
          {adoptable.length ? (
            <button type="button" onClick={adoptAll} className="ml-auto rounded-md border border-stroke px-2.5 py-1 text-[12px] text-content/75 hover:bg-content/10" title={t("decisions.adoptHint")}>
              {t("decisions.adoptAll", { count: adoptable.length })}
            </button>
          ) : null}
        </header>
        {adopted ? (
          <div className="flex items-center gap-2 rounded-md bg-content/5 px-3 py-2 text-[12px] text-content/70">
            {t("decisions.adopted", { count: adopted.count })}
            <button type="button" onClick={() => run(async () => (await mutateSoloyard("revertBatch", adopted.batch), setAdopted(null)))} className="ml-auto text-accent hover:underline">
              {t("decisions.undo")}
            </button>
          </div>
        ) : null}
        {notice ? <p role="alert" className="text-[12px] text-red-400/90">{notice}</p> : null}
        {!decisions.length ? <p className="py-8 text-center text-[12px] text-content/45">{t("decisions.empty")}</p> : null}
        {pending.length ? <h2 className="text-[11px] font-medium uppercase tracking-wide text-content/40">{t("decisions.pending")}</h2> : null}
        {pending.map((d) => <DecisionCard key={d.id} d={d} evidence={evidence} cwd={cwd} focused={focus === d.code} onPick={(o) => run(() => mutateSoloyard("decide", project.id, d.code, o))} />)}
        {decided.length ? <h2 className="mt-2 text-[11px] font-medium uppercase tracking-wide text-content/40">{t("decisions.decided")}</h2> : null}
        {decided.map((d) => <DecisionCard key={d.id} d={d} evidence={evidence} cwd={cwd} focused={focus === d.code} onPick={(o) => run(() => mutateSoloyard("decide", project.id, d.code, o))} />)}
      </div>
    </div>
  );
}

function DecisionCard({ d, evidence, cwd, focused, onPick }: { d: Decision; evidence: Evidence[]; cwd: string; focused: boolean; onPick: (option: string) => void }) {
  const { t, i18n } = useTranslation("soloyard");
  const done = d.status === "decided";
  const [open, setOpen] = useState(!done || focused);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "start" });
  }, [focused]);
  const chosen = d.options?.find((o) => o.key === d.user?.option);
  const sub = "text-[11px] font-medium uppercase tracking-wide text-content/40";
  return (
    <section ref={ref} className={`flex flex-col gap-3 rounded-lg border p-4 ${focused ? "border-accent/50" : "border-stroke"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
        <span className="font-mono text-[12px] text-content/45">{d.code}</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-content">{d.title}</span>
        <span className={`shrink-0 rounded px-1.5 text-[10.5px] ${d.door === "one-way" ? "bg-red-400/10 text-red-300" : "bg-content/5 text-content/55"}`}>
          {t(d.door === "one-way" ? "overview.oneWay" : "overview.twoWay")}
        </span>
        {done ? <span className="shrink-0 text-[12px] text-emerald-300/80">{t("decisions.chose", { option: chosen ? `${chosen.key} · ${chosen.label}` : d.user?.option })}</span> : null}
      </button>
      {open ? (
        <>
          {d.context ? <AgentMarkdown text={d.context} streaming={false} /> : null}
          {d.evidence?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {d.evidence.map((code) => {
                const e = evidence.find((x) => x.code === code);
                return (
                  <button
                    key={code}
                    type="button"
                    title={e ? [e.claim, e.quote && `「${e.quote}」`, e.platform].filter(Boolean).join("\n") : undefined}
                    onClick={() => openProjectView({ cwd, view: "evidence", title: viewLabel("evidence") })}
                    className="rounded border border-accent/30 px-1.5 font-mono text-[11px] text-accent hover:bg-accent/10"
                  >
                    {code}
                    {e?.level ? <span className="ml-1 text-content/45">{e.level}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          {d.options?.length ? (
            <div className="flex flex-col gap-1.5">
              <span className={sub}>{t("decisions.options")}</span>
              {d.options.map((o) => {
                const isChosen = d.user?.option === o.key;
                return (
                  <div key={o.key} className={`flex items-start gap-3 rounded-md border px-3 py-2 ${isChosen ? "border-emerald-400/40 bg-emerald-400/5" : "border-stroke"}`}>
                    <span className="mt-0.5 font-mono text-[12px] text-content/50">{o.key}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px]">
                      <span className="flex items-center gap-2 text-content">
                        {o.label}
                        {d.ai?.option === o.key ? <span className="rounded bg-accent/10 px-1.5 text-[10.5px] text-accent">{t("decisions.aiPick")}</span> : null}
                      </span>
                      {o.benefit ? <span className="text-content/60">+ {o.benefit}</span> : null}
                      {o.cost ? <span className="text-content/60">− {o.cost}</span> : null}
                      {o.reversibility ? <span className="text-content/45">{t("decisions.reversibility", { value: o.reversibility })}</span> : null}
                    </div>
                    {!isChosen ? (
                      <button type="button" onClick={() => onPick(o.key)} className="shrink-0 rounded-md border border-accent/50 px-2 py-0.5 text-[12px] text-accent hover:bg-accent/10">
                        {t(done ? "decisions.change" : "decisions.pick")}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {d.ai?.reason ? (
            <div className="flex flex-col gap-1">
              <span className={sub}>{t("decisions.aiReason", { option: d.ai.option ?? "" })}</span>
              <p className="text-[12.5px] text-content/80">{d.ai.reason}</p>
            </div>
          ) : null}
          {d.counter ? (
            <div className="flex flex-col gap-1">
              <span className={sub}>{t("decisions.counter")}</span>
              <p className="text-[12.5px] text-content/80">{d.counter}</p>
            </div>
          ) : null}
          {d.needs_info ? <p className="rounded-md bg-amber-400/5 px-3 py-2 text-[12px] text-amber-200/80">{t("decisions.needsInfo", { text: d.needs_info })}</p> : null}
          {d.user ? (
            <p className="text-[12px] text-content/55">
              {t(d.user.via === "对话" ? "decisions.byChat" : "decisions.byApp", {
                option: d.user.option,
                date: new Date(d.user.date).toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
              })}
              {d.user.quote ? ` 「${d.user.quote}」` : ""}
              {d.user.note ? ` · ${d.user.note}` : ""}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** 证据页：编号、等级、结论、原话、来源、访问日期，可以搜。 */
export function EvidenceView({ project }: { project: SoloyardProject }) {
  const { t } = useTranslation("soloyard");
  const [q, setQ] = useState("");
  const { data: evidence, error } = useSoloyard<Evidence[]>("listEvidence", project.id, { q });
  if (error) return <p className="p-6 text-[12px] text-red-400">{error}</p>;
  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 py-6">
        <header className="flex items-center gap-3">
          <h1 className="text-[16px] font-medium text-content">{viewLabel("evidence")}</h1>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("evidence.search")} className="ml-auto h-7 w-56 rounded-md border border-stroke bg-content/5 px-2 text-[12px] text-content outline-none" />
        </header>
        {evidence && !evidence.length ? <p className="py-8 text-center text-[12px] text-content/45">{t(q ? "evidence.noMatch" : "evidence.empty")}</p> : null}
        <ul className="flex flex-col">
          {evidence?.map((e) => (
            <li key={e.id} className="flex gap-3 border-b border-stroke py-2.5 text-[12.5px]">
              <span className="w-14 shrink-0 font-mono text-[12px] text-content/45">{e.code}</span>
              <span className="w-8 shrink-0 text-[12px] text-content/60">{e.level ?? "—"}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-content">{e.claim}</span>
                {e.quote ? <span className="text-content/60">「{e.quote}」</span> : null}
                <span className="flex flex-wrap gap-2 text-[11px] text-content/40">
                  {e.platform ? <span>{e.platform}</span> : null}
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="truncate text-accent/80 hover:underline">{e.url}</a> : null}
                  {e.accessed ? <span>{t("evidence.accessed", { date: e.accessed })}</span> : null}
                  {e.verified ? <span>{e.verified}</span> : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
