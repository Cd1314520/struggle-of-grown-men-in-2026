import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { BARE_URL, MD_LINK, shortUrl, unmark } from "../../lib/format";
import { md } from "../../lib/markdown";

// Markdown the app owns (profile files). The renderer escapes everything it does not turn into markup.
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={cn("prose", className)} dangerouslySetInnerHTML={{ __html: md(text) }} />;
}

// Plain text with its URLs clickable. Never parses HTML. An agent's markdown link shows its label: a link
// when it points at the web, the label alone when it names a local file. A bare address shows short
// ("gx.gallup.com/pa2-insight…") and never breaks across lines; the whole one is on hover.
const TOKEN = new RegExp(`${MD_LINK.source}|(${BARE_URL.source})`, "g"),
  WEB = /^https?:\/\//;
export function Linkified({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, label, target, url] = m;
    out.push(unmark(text.slice(last, m.index)));
    const to = url ?? (target && WEB.test(target) ? target : undefined);
    const named = label && !WEB.test(label);
    out.push(
      to ? (
        <a
          key={m.index}
          href={to}
          title={to}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("text-accent-text underline-offset-2 hover:underline", !named && "whitespace-nowrap")}
        >
          {named ? label : shortUrl(to)}
          <ArrowUpRight aria-hidden className="ml-px inline size-3 align-[-1px]" />
        </a>
      ) : (
        label
      ),
    );
    last = m.index + whole.length;
  }
  out.push(unmark(text.slice(last)));
  return <span className={cn("break-words whitespace-pre-line", className)}>{out}</span>;
}
