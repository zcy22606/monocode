import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";
import { Modal } from "../../../shared/ui/Modal";
import { listPackageScripts, relativeDir, type PackageScript } from "./api";
import { entryKey, upsertHistory, useServiceHistory } from "./history";

/** 「服务」分页的添加弹窗：勾选 package.json 里的脚本（可多选），或者自己写命令。只加进历史，不启动。 */
export function AddServiceDialog({ project, onClose }: { project: string; onClose: () => void }) {
  const { t } = useTranslation("soloyard");
  const history = useServiceHistory(project);
  const [scripts, setScripts] = useState<PackageScript[]>();
  const [scriptsError, setScriptsError] = useState<string>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [command, setCommand] = useState("");
  const [dir, setDir] = useState("");

  useEffect(() => {
    listPackageScripts(project).then(setScripts, (raw) => {
      setScripts([]);
      setScriptsError(String(raw));
    });
  }, [project]);

  const known = new Set(history.map(entryKey));
  const scriptKey = (script: PackageScript) => entryKey({ cwd: script.dir, command: script.command });
  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const custom = command.trim()
    ? { cwd: dir.trim() ? `${project.replace(/\/$/, "")}/${dir.trim().replace(/^\.?\/+|\/+$/g, "")}` : project, command: command.trim() }
    : undefined;
  const chosen = [
    ...(scripts ?? []).filter((script) => picked.has(scriptKey(script))).map((script) => ({ cwd: script.dir, command: script.command })),
    ...(custom ? [custom] : []),
  ];

  const add = () => {
    upsertHistory(project, chosen);
    onClose();
  };

  return (
    <Modal onClose={onClose} title={t("services.addTitle")} description={t("services.addDescription")}>
      <div className="flex min-h-0 flex-col gap-4 px-4 pb-4 pt-3">
        <section className="flex min-h-0 flex-col gap-1.5">
          <h3 className="text-[12px] font-medium text-content/60">{t("services.scripts")}</h3>
          <div className="max-h-64 overflow-y-auto rounded-md border border-stroke">
            {scriptsError ? (
              <p className="px-3 py-2 text-[12px] text-red-400">{scriptsError}</p>
            ) : !scripts ? null : !scripts.length ? (
              <p className="px-3 py-2 text-[12px] text-content/40">{t("services.noScripts")}</p>
            ) : (
              scripts.map((script) => {
                const key = scriptKey(script);
                const added = known.has(key);
                const sub = relativeDir(script.dir, project);
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-2 border-b border-stroke px-3 py-1.5 last:border-b-0 ${added ? "opacity-50" : "cursor-pointer hover:bg-content/5"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={added}
                      checked={added || picked.has(key)}
                      onChange={() => toggle(key)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2 text-[13px] text-content">
                        <span className="font-mono">{script.command}</span>
                        {sub ? <span className="truncate text-[11px] text-content/40">{sub}</span> : null}
                        {added ? <span className="text-[11px] text-content/40">{t("services.added")}</span> : null}
                      </span>
                      <span className="truncate font-mono text-[11px] text-content/40" title={script.script}>
                        {script.script}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12px] font-medium text-content/60">{t("services.custom")}</h3>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && chosen.length && add()}
            placeholder={t("services.commandPlaceholder")}
            spellCheck={false}
            className="h-8 rounded-md border border-stroke bg-transparent px-2 font-mono text-[12px] text-content outline-none placeholder:text-content/30 focus:border-accent"
          />
          <input
            value={dir}
            onChange={(event) => setDir(event.target.value)}
            placeholder={t("services.dirPlaceholder")}
            spellCheck={false}
            className="h-8 rounded-md border border-stroke bg-transparent px-2 font-mono text-[12px] text-content outline-none placeholder:text-content/30 focus:border-accent"
          />
        </section>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-[13px] text-content/70 hover:bg-content/10">
            {t("services.cancel")}
          </button>
          <button
            type="button"
            disabled={!chosen.length}
            onClick={add}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {t("services.addCount", { count: chosen.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
