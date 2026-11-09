interface Block {
  level: number;
  title: string;
  at: number;
  head: string;
  body: string;
}

export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [{ level: 0, title: "", at: 0, head: "", body: "" }];
  let fence = false;
  let at = 0;
  for (const line of text.split(/(?<=\n)/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.replace(/\n$/, ""));
    if (h) blocks.push({ level: h[1]?.length ?? 1, title: h[2] ?? "", at, head: line, body: "" });
    else {
      const last = blocks[blocks.length - 1];
      if (last) last.body += line;
    }
    at += line.length;
  }
  return blocks;
}

export function outline(blocks: readonly Block[], q: string, title: string) {
  const hidden = blocks.find(b => b.level > 0);
  const hide = hidden?.level === 1 && hidden.title.trim().toLowerCase() === title.toLowerCase() ? hidden : null;
  const heads: number[] = [];
  const hits: number[] = [];
  const parts: string[] = [];
  const emit = (b: Block, whole: boolean) => {
    if (b !== hide && b.level > 0) {
      parts.push(b.head.endsWith("\n") ? b.head : `${b.head}\n`);
      heads.push(b.at);
    }
    if (whole) parts.push(b.body);
  };
  const needle = q.trim().toLowerCase();
  if (!needle) {
    for (const b of blocks) emit(b, true);
    return { text: parts.join(""), heads, hits, count: undefined };
  }
  const shown = new Set<Block>();
  let count = 0;
  blocks.forEach((b, i) => {
    if (b.level === 0 || b === hide || !`${b.title}\n${b.body}`.toLowerCase().includes(needle)) return;
    count++;
    const chain: Block[] = [];
    let level = b.level;
    for (let j = i - 1; j >= 0 && level > 2; j--) {
      const a = blocks[j];
      if (a && a.level > 1 && a.level < level) {
        chain.unshift(a);
        level = a.level;
      }
    }
    for (const a of chain)
      if (!shown.has(a)) {
        shown.add(a);
        emit(a, false);
        parts.push("\n");
      }
    shown.add(b);
    hits.push(heads.length);
    emit(b, true);
  });
  return { text: parts.join(""), heads, hits, count };
}
