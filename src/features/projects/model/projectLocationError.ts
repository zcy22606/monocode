import { displayPath } from "../../../shared/lib/paths";
import { t } from "../../../i18n";

/** Requires reconnecting the project before the user retries submission. */
export class ProjectNotFoundError extends Error {
  constructor(cwd: string) {
    super(
      t("projects:errors.folderNotFound", { path: displayPath(cwd) }),
    );
    this.name = "ProjectNotFoundError";
  }
}
