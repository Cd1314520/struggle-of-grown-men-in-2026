// The Overview's headings: every one set as the lists' group bands are, the charts' sections too.
import { ArrowRight } from "lucide-react";
import { ListGroup } from "../../components/ui";

// A chart section's h2 (in its head, the section's first child) set as the lists' labels are.
export const LABEL_HEAD = "[&>div:first-child_h2]:text-sm [&>div:first-child_h2]:font-medium";

// The head of a list in the rail: its label, and a way to the page that holds all of it.
export function RailHead({ label, count, link }: { label: string; count?: number | undefined; link?: { href: string; label: string } | false }) {
  return (
    <ListGroup
      label={label}
      count={count}
      sticky={false}
      className="h-11 touch:h-12 [&>:has(>a)]:ml-auto"
      hint={
        link && (
          <a href={link.href} className="inline-flex items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg touch:-my-2 touch:py-2">
            {link.label}
            <ArrowRight className="size-3.5" />
          </a>
        )
      }
    />
  );
}
