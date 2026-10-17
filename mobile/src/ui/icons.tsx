/** 和桌面端同一套 Hugeicons；按图标单独引用，不把整个图标库打进包里。 */
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowTurnBackwardIcon from "@hugeicons/core-free-icons/ArrowTurnBackwardIcon";
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";
import Share02Icon from "@hugeicons/core-free-icons/Share02Icon";
import TaskDone01Icon from "@hugeicons/core-free-icons/TaskDone01Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import WifiDisconnected01Icon from "@hugeicons/core-free-icons/WifiDisconnected01Icon";

const ICONS = {
  add: Add01Icon,
  alert: AlertCircleIcon,
  back: ArrowLeft01Icon,
  brain: BrainIcon,
  check: Tick02Icon,
  checkCircle: CheckmarkCircle02Icon,
  chevronDown: ArrowDown01Icon,
  chevronRight: ArrowRight01Icon,
  close: Cancel01Icon,
  computer: ComputerIcon,
  copy: Copy01Icon,
  download: Download04Icon,
  edit: PencilEdit02Icon,
  file: File01Icon,
  folder: Folder01Icon,
  folderOpen: FolderOpenIcon,
  logout: Logout01Icon,
  openWith: LinkSquare02Icon,
  offline: WifiDisconnected01Icon,
  question: HelpCircleIcon,
  refresh: RefreshIcon,
  retry: ArrowTurnBackwardIcon,
  search: Search01Icon,
  send: ArrowUp02Icon,
  server: ServerStack01Icon,
  share: Share02Icon,
  tasks: TaskDone01Icon,
  terminal: CommandLineIcon,
} satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className, strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return <HugeiconsIcon icon={ICONS[name]} size={size} strokeWidth={strokeWidth} className={className} />;
}
