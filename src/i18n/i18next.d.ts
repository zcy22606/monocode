// Soloyard：用英文翻译生成 key 的类型；加命名空间时在这里加一行。
import type agentApp from "./locales/en/agentApp.json";
import type app from "./locales/en/app.json";
import type artifacts from "./locales/en/artifacts.json";
import type automations from "./locales/en/automations.json";
import type common from "./locales/en/common.json";
import type connections from "./locales/en/connections.json";
import type files from "./locales/en/files.json";
import type inbox from "./locales/en/inbox.json";
import type monos from "./locales/en/monos.json";
import type soloyard from "./locales/en/soloyard.json";
import type notes from "./locales/en/notes.json";
import type notifications from "./locales/en/notifications.json";
import type orchestration from "./locales/en/orchestration.json";
import type projects from "./locales/en/projects.json";
import type providers from "./locales/en/providers.json";
import type quickComposer from "./locales/en/quickComposer.json";
import type search from "./locales/en/search.json";
import type sessions from "./locales/en/sessions.json";
import type settings from "./locales/en/settings.json";
import type shared from "./locales/en/shared.json";
import type shell from "./locales/en/shell.json";
import type skills from "./locales/en/skills.json";
import type sourceControl from "./locales/en/sourceControl.json";
import type terminal from "./locales/en/terminal.json";
import type workspace from "./locales/en/workspace.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      agentApp: typeof agentApp;
      app: typeof app;
      artifacts: typeof artifacts;
      automations: typeof automations;
      common: typeof common;
      connections: typeof connections;
      files: typeof files;
      inbox: typeof inbox;
      monos: typeof monos;
      soloyard: typeof soloyard;
      notes: typeof notes;
      notifications: typeof notifications;
      orchestration: typeof orchestration;
      projects: typeof projects;
      providers: typeof providers;
      quickComposer: typeof quickComposer;
      search: typeof search;
      sessions: typeof sessions;
      settings: typeof settings;
      shared: typeof shared;
      shell: typeof shell;
      skills: typeof skills;
      sourceControl: typeof sourceControl;
      terminal: typeof terminal;
      workspace: typeof workspace;
    };
  }
}
