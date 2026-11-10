import Link from "next/link";
import { PriorityMark } from "@/components/PriorityMark";
import { StatusBadge } from "@/components/StatusBadge";
import type { Inbox } from "@/lib/services";

export function InboxSection({ inbox }: { inbox: Inbox }) {
  if (inbox.total === 0) {
    return (
      <section className="bb-inbox" aria-label="待我处理">
        <p className="bb-inbox-empty">现在没有需要你处理的报障</p>
      </section>
    );
  }

  return (
    <section className="bb-inbox" aria-labelledby="bb-inbox-title">
      <div className="bb-inbox-head">
        <h2 id="bb-inbox-title">待我处理</h2>
        <span className="bb-inbox-total">{inbox.total}</span>
      </div>
      {inbox.groups.map((group) => (
        <div key={group.projectId} className="bb-inbox-group">
          <h3>
            <Link href={`/projects/${group.projectId}/bugs`}>{group.projectName}</Link>
          </h3>
          <p className="bb-inbox-meta">
            {group.counts.map((count) => `${count.label} ${count.count}`).join(" · ")}
          </p>
          <ul className="bb-inbox-list">
            {group.items.map((item) => (
              <li key={item.id}>
                <Link href={`/bugs/${item.id}`} className="bb-inbox-row">
                  <PriorityMark priority={item.priority} />
                  <span className="bb-inbox-id">{item.publicId}</span>
                  <span className="bb-inbox-title">{item.title}</span>
                  <StatusBadge status={item.status} />
                  <span className="bb-inbox-hint">{item.hint}</span>
                </Link>
              </li>
            ))}
            {group.pendingOverflow > 0 ? (
              <li>
                <Link
                  href={`/projects/${group.projectId}/bugs?status=pending`}
                  className="bb-inbox-more"
                >
                  其余 {group.pendingOverflow} 条待处理
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
      ))}
    </section>
  );
}
