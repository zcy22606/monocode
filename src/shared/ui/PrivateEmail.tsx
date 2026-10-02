import { useState } from "react";
import { useTranslation } from "../../i18n";

/** Keep account emails private in screenshots until explicitly revealed. */
export function PrivateEmail({ email }: { email: string }) {
  const { t } = useTranslation("shared");
  const [revealed, setRevealed] = useState(false);
  const action = revealed ? t("privateEmail.hide") : t("privateEmail.reveal");

  return (
    <button
      type="button"
      aria-label={action}
      aria-pressed={revealed}
      title={action}
      className="pointer-events-auto relative min-w-0 truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-accent"
      onClick={(event) => {
        event.stopPropagation();
        setRevealed((value) => !value);
      }}
    >
      <span
        aria-hidden={!revealed}
        className={revealed ? undefined : "select-none blur-[5px]"}
      >
        {email}
      </span>
    </button>
  );
}
