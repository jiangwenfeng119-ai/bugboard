export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type ProseBlock =
  | { type: "heading"; level: 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const LABELS = [
  "原来的问题",
  "现在的表现",
  "请这样重测",
  "现在的做法",
  "这张单要的是",
  "复现步骤",
  "环境",
  "期望",
  "实际",
];

const HEADING = /^(#{1,6})\s+(\S.*)$/;
const ORDERED = /^(\d{1,3})[.、)]\s*(\S.*)$/;
const UNORDERED = /^[-*]\s+(\S.*)$/;

function promoteLabels(text: string) {
  const re = new RegExp(`^(${LABELS.join("|")})\\s*[:：]\\s*(.*)$`);
  return text
    .split("\n")
    .flatMap((line) => {
      const match = line.match(re);
      if (!match) return [line];
      const rest = match[2].trim();
      return rest ? [`## ${match[1]}`, "", rest] : [`## ${match[1]}`];
    })
    .join("\n");
}

function safeHref(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseInline(text: string): Inline[] {
  const pattern =
    /(`[^`\n]+`)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*/g;
  const items: Inline[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) items.push({ type: "text", text: text.slice(cursor, index) });
    if (match[1]) {
      items.push({ type: "code", text: match[1].slice(1, -1) });
    } else if (match[2] && match[3]) {
      const href = safeHref(match[3]);
      items.push(
        href
          ? { type: "link", text: match[2], href }
          : { type: "text", text: match[0] }
      );
    } else if (match[4]) {
      items.push({ type: "strong", text: match[4] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) items.push({ type: "text", text: text.slice(cursor) });
  return items.length > 0 ? items : [{ type: "text", text: "" }];
}

export function parseProse(raw: string): ProseBlock[] {
  const text = promoteLabels(raw.replace(/\r\n/g, "\n")).replace(/^\n+|\n+$/g, "");
  if (!text.trim()) return [];
  const lines = text.split("\n");
  const blocks: ProseBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const heading = lines[index].match(HEADING);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length <= 2 ? 2 : 3,
        inlines: parseInline(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    const ordered = lines[index].match(ORDERED);
    const unordered = lines[index].match(UNORDERED);
    if (ordered || unordered) {
      const isOrdered = Boolean(ordered);
      const items: Inline[][] = [];
      while (index < lines.length && lines[index].trim()) {
        const item = lines[index].match(isOrdered ? ORDERED : UNORDERED);
        if (!item) break;
        items.push(parseInline((isOrdered ? item[2] : item[1]).trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    const paragraph: Inline[][] = [];
    while (index < lines.length && lines[index].trim()) {
      if (
        HEADING.test(lines[index]) ||
        ORDERED.test(lines[index]) ||
        UNORDERED.test(lines[index])
      ) {
        break;
      }
      paragraph.push(parseInline(lines[index].trim()));
      index += 1;
    }
    if (paragraph.length > 0) blocks.push({ type: "paragraph", lines: paragraph });
  }

  return blocks;
}
