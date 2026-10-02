import type { IssueStatus } from "../../model/issues";
import { priorityLabel, statusLabel } from "../../model/issues";

const STATUS_TONE: Record<IssueStatus, string> = {
  backlog: "text-content/40",
  todo: "text-content/60",
  in_progress: "text-amber-400",
  in_review: "text-sky-400",
  done: "text-accent",
  canceled: "text-content/40",
};

/** 状态永远是「形状 + 名字」，颜色只是辅助。 */
export function StatusIcon({ status, className = "" }: { status: IssueStatus; className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={`size-3.5 shrink-0 ${STATUS_TONE[status]} ${className}`} role="img" aria-label={statusLabel(status)}>
      {status === "backlog" && <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />}
      {status === "todo" && <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {status === "in_progress" && (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      )}
      {status === "in_review" && (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="3" fill="currentColor" />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--color-background-base)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "canceled" && (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M5 5l4 4M9 5l-4 4" stroke="var(--color-background-base)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function PriorityIcon({ priority }: { priority: number }) {
  const label = priorityLabel(priority);
  if (priority === 1) {
    return (
      <span role="img" aria-label={label} className="grid size-3.5 shrink-0 place-items-center rounded-[3px] bg-red-400 text-[10px] font-bold leading-none text-black">
        !
      </span>
    );
  }
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 text-content/60" role="img" aria-label={label}>
      {priority === 0 ? (
        <path d="M3 7h1.5M6.25 7h1.5M9.5 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        [0, 1, 2].map((i) => (
          <rect key={i} x={2.5 + i * 3.5} y={10 - (i + 1) * 2.5} width="2.5" height={(i + 1) * 2.5 + 1} rx="0.5" fill="currentColor" opacity={i < 5 - priority ? 1 : 0.3} />
        ))
      )}
    </svg>
  );
}
