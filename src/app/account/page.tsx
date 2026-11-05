import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/session-guard";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "修改密码",
};

export default async function AccountPage() {
  const identity = await requireUser();

  return (
    <AppShell username={identity.username} role={identity.role}>
      <div className="bb-account">
        <div className="bb-page-head">
          <div>
            <Link href="/projects" className="bb-crumb">
              ← 返回项目
            </Link>
            <h1>修改密码</h1>
            <p className="bb-muted" style={{ margin: "0.45rem 0 0" }}>
              当前账号 {identity.username}。保存后这次登录仍然有效，下次请用新密码登录。
            </p>
          </div>
        </div>
        <section className="bb-card bb-account-card">
          <PasswordForm />
        </section>
      </div>
    </AppShell>
  );
}
