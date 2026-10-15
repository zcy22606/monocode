import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";
import { basename } from "../../../platform/tauri/fs";
import { watchFile } from "../../files/model/fileWatch";
import { previewUrlPath } from "../model/filePreviews";

/** Where a preview frame loads a local file from (`soloyard_preview.rs`). */
export function frameUrl(path: string, cwd: string): string {
  return `${convertFileSrc("", "soloyardpreview")}${previewUrlPath(path, cwd)}`;
}

/** Soloyard: PDFs in WebKit's own viewer, reloaded when the file is rewritten. */
export function PdfPreview({ path, cwd }: { path: string; cwd: string }) {
  const { t } = useTranslation("soloyard");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let timer = 0;
    const stop = watchFile(path, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVersion((value) => value + 1), 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path]);

  // No sandbox: it would disable the PDF plugin. The scheme sandboxes every other page.
  return (
    <iframe
      key={version}
      src={frameUrl(path, cwd)}
      title={t("filePreview.frameTitle", { name: basename(path) })}
      className="h-full w-full border-0"
    />
  );
}
