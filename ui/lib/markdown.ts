// Markdown, as far as the profile files use it: headings, nested lists, quotes, code, rules, bold, italic, links.
import { esc } from "./format";

const inline = (s: string) =>
  esc(s)
    .split(/(`[^`]+`)/)
    .map(p =>
      p.startsWith("`") && p.length > 2
        ? `<code>${p.slice(1, -1)}</code>`
        : p
            .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
            .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
            .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'),
    )
    .join("");

export function md(text: string) {
  let out = "",
    para: string[] = [];
  const lists: { indent: number; tag: "ul" | "ol" }[] = []; // the open lists, outermost first
  const flush = () => {
    if (para.length) out += `<p>${para.map(inline).join("<br>")}</p>`;
    para = [];
  };
  const close = (to = -1) => {
    for (let last = lists.at(-1); last && last.indent > to; last = lists.at(-1)) {
      out += `</li></${last.tag}>`;
      lists.pop();
    }
  };
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "",
      item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line),
      head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (/^\s*```/.test(line)) {
      flush();
      close();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i] ?? "")) code.push(lines[i] ?? "");
      out += `<pre>${esc(code.join("\n"))}</pre>`;
    } else if (head) {
      const level = (head[1] ?? "").length;
      flush();
      close();
      out += `<h${level}>${inline(head[2] ?? "")}</h${level}>`;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      close();
      out += "<hr>";
    } else if (item) {
      flush();
      const indent = (item[1] ?? "").length,
        tag = /\d/.test(item[2] ?? "") ? "ol" : "ul";
      close(indent);
      if (lists.at(-1)?.indent === indent) out += "</li><li>";
      else {
        lists.push({ indent, tag });
        out += `<${tag}><li>`;
      }
      out += inline(item[3] ?? "");
    } else if (!line.trim()) {
      flush();
      if (!/^\s/.test(lines[i + 1] ?? "") || !lists.length) close();
    } else if (lists.length && /^\s/.test(line)) out += (para.length ? "" : "<br>") + inline(line.trim());
    else if (/^>\s?/.test(line)) {
      flush();
      close();
      out += `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`;
    } else {
      close();
      para.push(line);
    }
  }
  flush();
  close();
  return out;
}
