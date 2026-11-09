import {
  Bot,
  Building2,
  CircleSlash,
  CircleUserRound,
  Hand,
  ListChecks,
  Mail,
  Radar,
  RefreshCw,
  Search,
  Send,
  TriangleAlert,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ListIcon } from "../../components/ui";
import type { FeedRow } from "./feed";

const KIND_ICON: Record<string, LucideIcon> = {
  gate: Hand,
  user: CircleUserRound,
  error: TriangleAlert,
  mail: Mail,
  auto: Zap,
  recheck: ListChecks,
  migration: Wrench,
};
const KIND_TONE: Record<string, "warning" | "danger" | "info"> = { gate: "warning", error: "danger", mail: "info" };
const SYSTEM_ICON: [RegExp, LucideIcon][] = [
  [/^Checked mail/, Mail],
  [/^(Looked for|Found) the employer/, Search],
  [/^(Checked|Found|Screened out) /, Radar],
  [/^Recheck/, RefreshCw],
  [/^Looked for new companies/, Building2],
];

export function KindIcon({ row }: { row: Pick<FeedRow, "kind" | "text"> & Partial<Pick<FeedRow, "outcome" | "flag">> }) {
  if (row.kind === "result") return row.outcome === "submitted" ? <ListIcon icon={Send} tone="success" /> : <ListIcon icon={CircleSlash} />;
  const icon = (row.kind === "system" ? SYSTEM_ICON.find(([re]) => re.test(row.text))?.[1] : KIND_ICON[row.kind]) ?? Bot;
  return <ListIcon icon={icon} tone={row.flag ? "warning" : (KIND_TONE[row.kind] ?? (icon === Mail ? "info" : "neutral"))} />;
}
