/** Soloyard：决策和证据（数据在 soloyard/core/src/decisions.ts，字段照 product-thinking 的 SCHEMA）。 */
export type DecisionOption = { key: string; label: string; benefit?: string; cost?: string; reversibility?: string };
export type Decision = {
  id: number;
  code: string;
  title: string;
  door: string | null;
  status: string;
  context?: string;
  evidence?: string[];
  options?: DecisionOption[];
  ai?: { option?: string; reason?: string; level?: string };
  counter?: string;
  needs_info?: string;
  user?: { option: string; note?: string; date: string; via: string; by: string; quote?: string } | null;
};
export type Evidence = {
  id: number;
  code: string;
  level: string | null;
  verified: string | null;
  claim?: string;
  quote?: string;
  url?: string;
  platform?: string;
  accessed?: string;
};
