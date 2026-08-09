"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthenticatedUser, UserRole } from "@/lib/types";

type MobileNavItem = {
  href: string;
  label: string;
};

const guestMobileItems: MobileNavItem[] = [
  { href: "/", label: "หน้าแรก" },
  { href: "/trainers", label: "ค้นหาเทรนเนอร์" },
  { href: "/login", label: "เข้าสู่ระบบ" },
  { href: "/register", label: "สมัครสมาชิก" },
];

const mobileItemsByRole: Record<UserRole, MobileNavItem[]> = {
  member: [
    { href: "/", label: "หน้าแรก" },
    { href: "/member", label: "การจอง" },
    { href: "/chat", label: "แชต" },
  ],
  trainer: [
    { href: "/", label: "หน้าแรก" },
    { href: "/trainer", label: "งานของฉัน" },
    { href: "/chat", label: "แชต" },
  ],
  admin: [
    { href: "/", label: "หน้าแรก" },
    { href: "/admin", label: "คิวตรวจ" },
    { href: "/chat", label: "แชต" },
  ],
};

function isCurrentDestination(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileRoleNav({ user }: { user: AuthenticatedUser | null }) {
  const pathname = usePathname();
  const items = user ? mobileItemsByRole[user.role] : guestMobileItems;

  return (
    <nav className="mobile-role-nav" aria-label="เมนูหลักบนมือถือ">
      {items.map((item) => {
        const current = isCurrentDestination(pathname, item.href);
        return (
          <Link href={item.href} key={item.href} aria-current={current ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
