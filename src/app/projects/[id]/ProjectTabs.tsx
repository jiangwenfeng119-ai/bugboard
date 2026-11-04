"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChart, IconTicket, IconUsers } from "@/components/Icons";

export function ProjectTabs({
  projectId,
  isAdmin,
}: {
  projectId: number;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const tabs = [
    {
      href: `${base}/bugs`,
      label: "报障",
      icon: <IconTicket size={15} />,
      match: (p: string) => p.startsWith(`${base}/bugs`),
    },
    {
      href: `${base}/summary`,
      label: "汇总",
      icon: <IconChart size={15} />,
      match: (p: string) => p.startsWith(`${base}/summary`),
    },
    ...(isAdmin
      ? [
          {
            href: `${base}/members`,
            label: "成员",
            icon: <IconUsers size={15} />,
            match: (p: string) => p.startsWith(`${base}/members`),
          },
        ]
      : []),
  ];

  return (
    <nav className="bb-tabs" aria-label="项目分区">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="bb-tab"
          aria-current={t.match(pathname) ? "page" : undefined}
        >
          <span className="bb-tab-icon" aria-hidden>
            {t.icon}
          </span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
