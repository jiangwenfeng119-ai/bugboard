import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Prose } from "@/components/Prose";
import { readUserManual } from "@/lib/product-docs";
import { requireUser } from "@/lib/session-guard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "产品手册",
};

export default async function HelpPage() {
  const identity = await requireUser();
  const manual = readUserManual();

  return (
    <AppShell username={identity.username} role={identity.role}>
      <div className="bb-account">
        <div className="bb-page-head">
          <div>
            <Link href="/projects" className="bb-crumb">
              ← 返回项目
            </Link>
            <h1>产品手册</h1>
            <p className="bb-muted" style={{ margin: "0.45rem 0 0" }}>
              Bugboard 功能说明；版本记录见{" "}
              <Link href="/changelog">版本与更新日志</Link>。
            </p>
          </div>
        </div>
        <section className="bb-card bb-account-card">
          <Prose text={manual} empty="手册内容为空。" />
        </section>
      </div>
    </AppShell>
  );
}