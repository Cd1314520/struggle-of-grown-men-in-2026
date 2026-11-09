import { Fragment, type ReactNode } from "react";

function yamlLine(line: string): ReactNode {
  const hash = line.search(/(^|\s)#/);
  const [code, comment] = hash < 0 ? [line, ""] : [line.slice(0, hash), line.slice(hash)];
  const key = /^(\s*(?:- )?)([^\s:#][^:#]*?)(:)(\s|$)/.exec(code);
  return (
    <>
      {key ? (
        <>
          {key[1]}
          <span className="text-accent-text">{key[2]}</span>
          {code.slice((key[1]?.length ?? 0) + (key[2]?.length ?? 0))}
        </>
      ) : (
        code
      )}
      {comment && <span className="text-fg-muted">{comment}</span>}
    </>
  );
}

function typstLine(line: string): ReactNode {
  const at = line.indexOf("//");
  if (at < 0 || line.slice(0, at).includes(":/")) return line;
  return (
    <>
      {line.slice(0, at)}
      <span className="text-fg-muted">{line.slice(at)}</span>
    </>
  );
}

function lineStarts(lines: readonly string[]) {
  const out: number[] = [];
  let at = 0;
  for (const l of lines) {
    out.push(at);
    at += l.length + 1;
  }
  return out;
}

export function CodeView({ text, file }: { text: string; file: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  const paint = file.endsWith(".yml") ? yamlLine : typstLine;
  const starts = lineStarts(lines);
  return (
    <div className="py-4 font-mono text-sm">
      <div className="grid grid-cols-[auto_minmax(0,1fr)]">
        {lines.map((line, i) => {
          const indent = /^ *(?:(?:#|\/\/) *|- )?/.exec(line)?.[0].length ?? 0;
          return (
            <Fragment key={i}>
              <span aria-hidden className="tabular min-w-[calc(var(--list-x)+3ch+1rem)] pr-4 pl-(--list-x) text-right text-fg-subtle select-none">
                {i + 1}
              </span>
              <span
                data-at={starts[i]}
                className="pr-(--list-x) break-words whitespace-pre-wrap text-fg"
                style={indent ? { paddingLeft: `min(${indent}ch, 20vw)`, textIndent: `max(-${indent}ch, -20vw)` } : undefined}
              >
                {paint(line)}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
