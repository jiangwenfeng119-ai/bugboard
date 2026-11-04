"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isAdminRole, roleLabel } from "@/lib/roles";
import { BrandMark } from "./BrandMark";
import { IconKey, IconLogout, IconShield } from "./Icons";

type Props = {
  username: string;
  role: string;
  children: React.ReactNode;
  projectSwitcher?: React.ReactNode;
};

export function AppShell({
  username,
  role,
  children,
  projectSwitcher,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const initial = username.slice(0, 1).toUpperCase();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="bb-shell">
      <header className="bb-topbar">
        <Link href="/projects" className="bb-brand">
          <BrandMark />
          Bugboard
        </Link>
        <div style={{ flex: 1 }}>{projectSwitcher}</div>
        <nav className="bb-top-nav">
          {isAdminRole(role) ? (
            <Link href="/admin" className="bb-btn bb-btn-ghost">
              <IconShield size={15} />
              管理后台
            </Link>
          ) : null}
          <Link
            href="/account"
            className={`bb-btn bb-btn-ghost${pathname === "/account" ? " is-active" : ""}`}
          >
            <IconKey size={15} />
            修改密码
          </Link>
          <span className="bb-user-chip" title={username}>
            <span className="bb-user-avatar" aria-hidden>
              {initial}
            </span>
            {username}
            {isAdminRole(role) ? ` · ${roleLabel(role)}` : ""}
          </span>
          <button type="button" className="bb-btn bb-btn-secondary" onClick={logout}>
            <IconLogout size={15} />
            退出
          </button>
        </nav>
      </header>
      <main className="bb-main">{children}</main>
    </div>
  );
}
