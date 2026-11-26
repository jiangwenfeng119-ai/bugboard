const EXCERPT_HEADINGS = ["## Summary", "## God Nodes", "## Surprising Connections"];

export function reportExcerpt(markdown: string, max = 1500) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const parts: string[] = [];
  for (const heading of EXCERPT_HEADINGS) {
    const start = text.indexOf(heading);
    if (start < 0) continue;
    const rest = text.slice(start + heading.length);
    const next = rest.search(/\n## /);
    const body = (next < 0 ? rest : rest.slice(0, next)).trim();
    if (body) parts.push(`${heading}\n${body}`);
  }
  const source = (parts.join("\n\n") || text).trim();
  if (source.length <= max) return source;
  return `${source.slice(0, max).trimEnd()}…`;
}

export function graphSize(report: string) {
  const match = String(report || "").match(/(\d+) nodes · (\d+) edges/);
  if (!match) return null;
  return { nodes: Number(match[1]), edges: Number(match[2]) };
}
