import { IconTicket, IconUsers } from "@/components/Icons";

const agentSteps = [
  { label: "待处理", badge: "bb-badge bb-badge-pending" },
  { label: "修复中", badge: "bb-badge bb-badge-fixing" },
  { label: "待发布", badge: "bb-badge bb-badge-ready_to_release" },
];

export function AuthStory() {
  return (
    <div className="bb-auth-story">
      <section className="bb-auth-lane">
        <div className="bb-auth-lane-title">
          <IconTicket size={15} />
          <h3>Agent 自动处理</h3>
        </div>
        <ol className="bb-auth-flow">
          {agentSteps.map((step, index) => (
            <li key={step.label}>
              {index > 0 ? <span className="bb-auth-flow-join" aria-hidden /> : null}
              <span className={step.badge}>{step.label}</span>
            </li>
          ))}
        </ol>
        <p>新建或回到待处理时，Agent 接单、写修复说明，并排进发布队列。</p>
      </section>
      <section className="bb-auth-lane">
        <div className="bb-auth-lane-title">
          <IconUsers size={15} />
          <h3>人在回路</h3>
        </div>
        <ul className="bb-auth-people">
          <li>
            <span className="bb-auth-who">产品经理</span>
            <span className="bb-auth-decision">
              <span className="bb-badge bb-badge-needs_product">待产品经理确认</span>
              <span className="bb-auth-then">可以做，或标为不属实</span>
            </span>
          </li>
          <li>
            <span className="bb-auth-who">原报障人</span>
            <span className="bb-auth-decision">
              <span className="bb-badge bb-badge-awaiting_confirm">待确认</span>
              <span className="bb-auth-then">确认已修复，或打回</span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
