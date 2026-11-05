"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAdminRole, roleLabel } from "@/lib/roles";
import { BrandMark } from "./BrandMark";
import { IconChevronDown, IconKey, IconLogout, IconShield } from "./Icons";

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
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const initial = username.slice(0, 1).toUpperCase();
  const label = isAdminRole(role) ? `${username} · ${roleLabel(role)}` : username;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setOpen(false);
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
        <div className="bb-top-switch">{projectSwitcher}</div>
        <nav className="bb-top-nav">
          {isAdminRole(role) ? (
            <Link href="/admin" className="bb-btn bb-btn-ghost">
              <IconShield size={15} />
              管理后台
            </Link>
          ) : null}
          <div className="bb-user-menu" ref={rootRef}>
            <button
              ref={triggerRef}
              type="button"
              className={`bb-user-chip${open ? " is-open" : ""}`}
              title={label}
              aria-haspopup="true"
              aria-expanded={open}
              aria-controls={menuId}
              onClick={() => setOpen((value) => !value)}
            >
              <span className="bb-user-avatar" aria-hidden>
                {initial}
              </span>
              <span className="bb-user-name">{label}</span>
              <IconChevronDown size={14} className="bb-user-chevron" />
            </button>
            {open ? (
              <div id={menuId} className="bb-user-menu-panel">
                <Link
                  href="/account"
                  className={`bb-user-menu-item${pathname === "/account" ? " is-active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  <IconKey size={15} />
                  修改密码
                </Link>
                <div className="bb-user-menu-sep" role="separator" />
                <button type="button" className="bb-user-menu-item" onClick={logout}>
                  <IconLogout size={15} />
                  退出
                </button>
              </div>
            ) : null}
          </div>
        </nav>
      </header>
      <main className="bb-main">{children}</main>
    </div>
  );
}
