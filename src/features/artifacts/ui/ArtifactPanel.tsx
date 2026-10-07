import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "../../../i18n";
import { Copy, Trash2 } from "../../../shared/ui/icons";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { IconButton } from "../../../app/shell/TitleBar";
import { MonoSidebar, MonoSidebarHeader } from "../../monos/ui/MonoSidebar";
import { artifactLabel, deleteArtifact } from "../artifacts";
import { ArtifactContent, useArtifact } from "./ArtifactContent";

export function ArtifactPanel({
  id,
  color,
  onClose,
  onOpenFile,
  windowControls,
}: {
  id: string;
  color: string;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
  windowControls?: ReactNode;
}) {
  const { t } = useTranslation("artifacts");
  const { artifact, loaded, error, setError } = useArtifact(id);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => setCopied(false), [id]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const label = artifactLabel(artifact?.kind ?? "document");
  const noun = label.toLowerCase();
  const onDelete = async () => {
    if (
      !artifact ||
      deleting ||
      !window.confirm(t("panel.confirmDelete", { title: artifact.title }))
    )
      return;
    setDeleting(true);
    setError(null);
    try {
      await deleteArtifact(artifact.id);
      if (mounted.current) onClose();
    } catch {
      setError(t("panel.deleteFailed", { noun }));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <MonoSidebar
      open
      kind="artifact"
      label={t("panel.reader", { label })}
      color={color}
      windowControls={windowControls}
    >
      <MonoSidebarHeader
        title={label}
        onClose={onClose}
        actions={
          artifact ? (
            <>
              <IconButton
                label={t("panel.delete", { noun })}
                disabled={deleting}
                onClick={() => void onDelete()}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
              <IconButton
                label={copied ? t("panel.copied") : t("panel.copy", { noun })}
                onClick={() =>
                  void copyMessage(artifact.body).then(
                    () => setCopied(true),
                    () => setError(t("panel.copyFailed", { noun })),
                  )
                }
              >
                <Copy className="size-3.5" />
              </IconButton>
            </>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-7 py-6">
        {!loaded ? (
          <p role="status" className="text-[13px] text-content/50">
            {t("panel.loading")}
          </p>
        ) : error && !artifact ? (
          <p role="alert" className="text-[13px] text-content/65">
            {error}
          </p>
        ) : !artifact ? (
          <p role="status" className="text-[13px] text-content/50">
            {t("panel.unavailable")}
          </p>
        ) : (
          <article data-artifact-reader={artifact.id}>
            <div className="mb-6">
              <h1 className="text-[22px] font-medium leading-snug text-content">
                {artifact.title}
              </h1>
              <p className="mt-2 text-[11px] text-content/45">
                {t("panel.updated", {
                  time: new Date(artifact.updatedAt).toLocaleString(),
                })}
              </p>
            </div>
            <ArtifactContent artifact={artifact} onOpenFile={onOpenFile} />
            {error ? (
              <p role="alert" className="mt-3 text-[12px] text-content/60">
                {error}
              </p>
            ) : null}
            <span role="status" className="sr-only">
              {copied ? t("panel.copiedStatus", { label }) : ""}
            </span>
          </article>
        )}
      </div>
    </MonoSidebar>
  );
}
