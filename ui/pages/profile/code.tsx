// A read-only view of a YAML or Typst file: line numbers, with comments and YAML keys set apart.
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
      {comment && <span className="text-fg-subtle">{comment}</span>}
    </>
  );
}

function typstLine(line: string): ReactNode {
  const at = line.indexOf("//");
  if (at < 0 || line.slice(0, at).includes(":/")) return line; // "https://" is not a comment
  return (
    <>
      {line.slice(0, at)}
      <span className="text-fg-subtle">{line.slice(at)}</span>
    </>
  );
}

export function CodeView({ text, file }: { text: string; file: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  const paint = file.endsWith(".yml") ? yamlLine : typstLine;
  return (
    <div className="py-3 font-mono text-xs leading-5">
      <div className="grid grid-cols-[auto_minmax(0,1fr)]">
        {lines.map((line, i) => (
          <Fragment key={i}>
            <span aria-hidden className="tabular pr-4 pl-5 text-right text-fg-subtle select-none">
              {i + 1}
            </span>
            <span className="pr-5 break-words whitespace-pre-wrap text-fg">{paint(line)}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
