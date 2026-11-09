import { isMap, isSeq, parseDocument } from "yaml";
import { ListBody, ListGroup, ListRow } from "../../components/ui";

interface Criterion {
  id: string;
  label: string;
  statement: string;
  required: boolean;
  weight: number;
  screen: boolean;
  at: number;
}

interface Phase {
  key: "practice" | "real";
  name: string;
  threshold: number | null;
  criteria: Criterion[];
}

const PHASES = [
  ["practice", "Practice"],
  ["real", "Real"],
] as const;

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function rubricOf(text: string): Phase[] | null {
  try {
    const doc = parseDocument(text);
    if (doc.errors.length) return null;
    const phases: Phase[] = [];
    for (const [key, name] of PHASES) {
      const node = doc.get(key, true);
      if (!isMap(node)) continue;
      const list = node.get("criteria", true);
      if (!isSeq(list)) continue;
      const threshold = node.get("threshold");
      const criteria = list.items.flatMap(item => {
        if (!isMap(item)) return [];
        const c = item.toJSON() as Record<string, unknown>;
        const weight = typeof c["weight"] === "number" ? c["weight"] : 0;
        return [
          {
            id: str(c["id"]),
            label: str(c["label"]) || str(c["id"]),
            statement: str(c["statement"]),
            required: c["required"] === true,
            weight,
            screen: c["screen"] !== false,
            at: item.range?.[0] ?? 0,
          },
        ];
      });
      phases.push({ key, name, threshold: typeof threshold === "number" ? threshold : null, criteria });
    }
    return phases.length ? phases : null;
  } catch {
    return null;
  }
}

const points = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} pts`;

export function RubricView({ phases, fallback }: { phases: Phase[]; fallback: { practice: number; real: number } | null }) {
  return (
    <ListBody label="Rubric criteria">
      {phases.map(p => {
        const required = p.criteria.filter(c => c.required);
        const weighted = p.criteria.filter(c => !c.required);
        const total = weighted.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
        const threshold = p.threshold ?? fallback?.[p.key];
        return [
          <ListGroup key={p.key} sticky={false} label={p.name} hint={threshold !== undefined ? `passes at ${threshold}` : undefined} />,
          ...required.map(c => <Row key={`${p.key}:${c.id}:r`} c={c} />),
          weighted.length > 0 && (
            <ListGroup key={`${p.key}:w`} label="Weighted" hint={`${total} pts`} sticky={false} className="bg-surface font-normal text-fg-muted" />
          ),
          ...weighted.map(c => <Row key={`${p.key}:${c.id}:w`} c={c} />),
        ];
      })}
    </ListBody>
  );
}

function Row({ c }: { c: Criterion }) {
  return (
    <ListRow
      data-at={c.at}
      title={
        <>
          {c.label}
          {!c.screen && <span className="ml-2 text-xs font-normal text-fg-subtle">full assessment only</span>}
        </>
      }
      titleLines={1}
      snippet={c.statement}
      snippetLines={3}
      fact={c.required ? <span className="text-sm text-fg">Required</span> : <span className="tabular text-sm text-fg-muted">{points(c.weight)}</span>}
    />
  );
}
