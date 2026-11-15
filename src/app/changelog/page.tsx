import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Prose } from "@/components/Prose";
import { appVersion, readProductChangelog } from "@/lib/product-docs";
import { requireUser } from "@/lib/session-guard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "版本与更新日志",
};

export default async function ChangelogPage() {
  const identity = await requireUser();
  const changelog = readProductChangelog();

  return (
    <AppShell username={identity.username} role={identity.role}>
      <div className="bb-account">
        <div className="bb-page-head">
          <div>
            <Link href="/projects" className="bb-crumb">
              ← 返回项目
            </Link>
            <h1>版本与更新日志</h1>
            <p className="bb-muted" style={{ margin: "0.45rem 0 0" }}>
              当前运行版本 <strong>v{appVersion}</strong>。此处记录 Bugboard
              产品自身更新，不含各项目「变更」Tab 里的被测仓库记录。
            </p>
          </div>
        </div>
        <section className="bb-card bb-account-card">
          <Prose text={changelog} empty="暂无更新记录。" />
        </section>
      </div>
    </AppShell>
  );
}