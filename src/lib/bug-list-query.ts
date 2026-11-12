import { BUG_SORT_KEYS } from "./services";

const STATUSES = new Set<string>([
  "pending",
  "fixing",
  "needs_info",
  "needs_product",
  "awaiting_confirm",
  "confirmed",
  "acknowledged",
  "invalid",
]);
const PRIORITIES = new Set<string>(["p1", "p2", "p3"]);
const SORTS = new Set<string>(BUG_SORT_KEYS);

export type BugListQueryInput = {
  status?: string | null;
  priority?: string | null;
  reporter?: string | null;
  q?: string | null;
  sort?: string | null;
  dir?: string | null;
};

function defaultDir(sort: string) {
  return sort === "updated" || sort === "created" || sort === "id" ? "desc" : "asc";
}

export function bugListQuery(input: BugListQueryInput) {
  const sp = new URLSearchParams();
  const status = input.status || "";
  const priority = input.priority || "";
  const reporter = input.reporter || "";
  const q = (input.q || "").trim().slice(0, 200);
  const sort = input.sort || "";
  const dir = input.dir || "";
  if (STATUSES.has(status)) sp.set("status", status);
  if (PRIORITIES.has(priority)) sp.set("priority", priority);
  if (/^(user|api_key):\d+$/.test(reporter)) sp.set("reporter", reporter);
  if (q) sp.set("q", q);
  if (SORTS.has(sort)) {
    sp.set("sort", sort);
    sp.set("dir", dir === "asc" || dir === "desc" ? dir : defaultDir(sort));
  }
  return sp.toString();
}

export function bugListQueryFromUnknown(raw?: string | null) {
  if (!raw) return "";
  const text = raw.startsWith("?") ? raw.slice(1) : raw;
  if (text.length > 2000) return "";
  return bugListQuery(Object.fromEntries(new URLSearchParams(text)));
}
