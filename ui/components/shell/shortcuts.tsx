import { cn } from "../../lib/cn";
import { combo } from "../../lib/hotkeys";
import { Dialog, DialogContent, Kbd } from "../ui";
import { NAV } from "./nav";
import { useShell } from "./state";

type Group = readonly [title: string, rows: readonly (readonly [keys: string[], what: string])[]];

const ANYWHERE: Group = ["Anywhere", [[[combo("K")], "Search and commands"]]];
const GO_TO: Group = ["Go to", NAV.flatMap(n => (n.go ? [[["G", n.go.toUpperCase()], n.label] as const] : []))];

const OPEN_JOB: Group = [
  "An open job",
  [
    [["A"], "Main action (Approve, Retry…)"],
    [["X"], "Reject"],
    [["H"], "Hold for later"],
    [["1", "–", "5"], "Switch tabs"],
  ],
];
const LISTS: Group = [
  "Lists",
  [
    [["J", "K"], "Next and previous item"],
    [["/"], "Search or filter the list"],
    [["Esc"], "Close the open job"],
  ],
];
const QUESTIONS: Group = [
  "Questions",
  [
    [["1", "–", "8"], "Pick an option"],
    [["↵"], "Type an answer"],
    [[combo("↵")], "Save and go to the next"],
    [["Esc"], "Leave the answer box"],
  ],
];

function Section({ group: [title, rows] }: { group: Group }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-fg-subtle">{title}</div>
      <div className="flex flex-col gap-2">
        {rows.map(([keys, what]) => (
          <div key={what} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-fg-muted">{what}</span>
            <span className="flex shrink-0 items-center gap-1">
              {keys.map(k =>
                k === "–" ? (
                  <span key={k} className="text-xs text-fg-subtle">
                    {k}
                  </span>
                ) : (
                  <Kbd key={k} className={cn("touch:inline-flex", k.length === 1 && "w-5 px-0")}>
                    {k}
                  </Kbd>
                ),
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useShell();
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent
        title="Keyboard shortcuts"
        className="sm:max-w-2xl"
        onOpenAutoFocus={e => {
          e.preventDefault();
        }}
      >
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Section group={ANYWHERE} />
            <Section group={OPEN_JOB} />
            <Section group={LISTS} />
          </div>
          <div className="flex flex-col gap-5">
            <Section group={QUESTIONS} />
            <Section group={GO_TO} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
