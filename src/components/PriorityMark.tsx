import type { Priority } from "@/lib/types";

export function PriorityMark({ priority }: { priority: Priority }) {
  return (
    <span className={`bb-priority bb-priority-${priority}`}>
      {priority.toUpperCase()}
    </span>
  );
}
