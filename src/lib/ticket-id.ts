import { shanghaiYymmdd } from "./time";

const CODE_RE = /^[A-Z][A-Z0-9]{1,7}$/;

export function suggestProjectCode(name: string, slug = "") {
  for (const source of [slug, name]) {
    const latin = source
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .replace(/^[0-9]+/, "");
    if (latin.length >= 2) return latin.slice(0, 6);
  }
  return "";
}

export function codesConflict(a: string, b: string) {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function assertUsableCode(raw: string, taken: string[]) {
  const code = raw.trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    throw new Error("缩写需为 2–8 位大写字母或数字，并以字母开头");
  }
  if (taken.some((existing) => codesConflict(existing, code))) {
    throw new Error("缩写与已有项目冲突，不能相同或互为前缀");
  }
  return code;
}

export function allocateProjectCode(name: string, slug: string, taken: string[]) {
  const suggested = suggestProjectCode(name, slug);
  const candidates: string[] = [];
  if (suggested) candidates.push(suggested);
  for (let n = 1; n <= 99; n++) candidates.push(`P${String(n).padStart(2, "0")}`);
  for (const candidate of candidates) {
    try {
      return assertUsableCode(candidate, taken);
    } catch {
      // try the next free abbreviation
    }
  }
  throw new Error("无法分配项目缩写");
}

export function nextPublicId(code: string, createdAt: string, existing: string[]) {
  const ymd = shanghaiYymmdd(createdAt);
  if (!ymd) throw new Error("创建时间无效");
  const prefix = `${code}${ymd}`;
  const used = new Set(existing);
  let max = 0;
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue;
    const tail = id.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue;
    max = Math.max(max, Number(tail));
  }
  let candidate = "";
  do {
    max += 1;
    candidate = `${prefix}${String(max).padStart(3, "0")}`;
  } while (used.has(candidate));
  return candidate;
}
