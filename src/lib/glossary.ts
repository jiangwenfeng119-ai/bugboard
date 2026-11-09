export type GlossarySource = {
  name?: string;
  description?: string;
  tech_stack?: string;
  product_manager?: string;
  experience_officer?: string;
  agent_notes?: string;
};

const SPLIT = /[\s,，、/|]+/u;

/** Names and product words the recognizer should prefer. Short, unique, capped. */
export function glossaryTerms(source: GlossarySource): string[] {
  const fields = [
    source.name,
    source.description,
    source.tech_stack,
    source.product_manager,
    source.experience_officer,
    source.agent_notes,
  ];
  const terms: string[] = [];
  const seen = new Set<string>();
  function add(raw: string) {
    const term = raw.trim();
    if (term.length < 2 || term.length > 32) return;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  }
  for (const field of fields) {
    if (!field) continue;
    const compact = field.trim();
    if (compact.length <= 32) add(compact);
    for (const part of compact.split(SPLIT)) add(part);
  }
  return terms.slice(0, 40);
}

export function glossaryPrompt(source: GlossarySource) {
  const terms = glossaryTerms(source);
  if (!terms.length) return "";
  return `专有名词：${terms.join("、")}`;
}
