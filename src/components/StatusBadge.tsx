import { STATUS_LABEL, type BugStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: BugStatus }) {
  return (
    <span className={`bb-badge bb-badge-${status}`}>{STATUS_LABEL[status]}</span>
  );
}
