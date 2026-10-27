"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/manage", label: "Shift and sections" },
  { href: "/manage/employees", label: "Employees" },
  { href: "/manage/menu", label: "Menu" },
  { href: "/manage/accounts", label: "Sign-in accounts" },
] as const;

export function ManageTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Management" className="flex flex-wrap gap-2 border-b border-glaze pb-4">
      {TABS.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-12 items-center rounded-lg px-4 text-base font-semibold ${
              current ? "bg-leaf text-white" : "border border-glaze bg-paper text-leaf hover:border-leaf"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
