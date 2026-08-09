"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck2,
  ClipboardCheck,
  Dumbbell,
  Home,
  LogIn,
  MessageCircle,
  Search,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { AuthenticatedUser, UserRole } from "@/lib/types";

type MobileNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const guestMobileItems: MobileNavItem[] = [
  { href: "/", label: "หน้าแรก", icon: Home },
  { href: "/trainers", label: "ค้นหาเทรนเนอร์", icon: Search },
  { href: "/login", label: "เข้าสู่ระบบ", icon: LogIn },
  { href: "/register", label: "สมัครสมาชิก", icon: UserPlus },
];

const mobileItemsByRole: Record<UserRole, MobileNavItem[]> = {
  member: [
    { href: "/", label: "หน้าแรก", icon: Home },
    { href: "/member", label: "การจอง", icon: CalendarCheck2 },
    { href: "/chat", label: "แชต", icon: MessageCircle },
  ],
  trainer: [
    { href: "/", label: "หน้าแรก", icon: Home },
    { href: "/trainer", label: "งานของฉัน", icon: Dumbbell },
    { href: "/chat", label: "แชต", icon: MessageCircle },
  ],
  admin: [
    { href: "/", label: "หน้าแรก", icon: Home },
    { href: "/admin", label: "คิวตรวจ", icon: ClipboardCheck },
    { href: "/chat", label: "แชต", icon: MessageCircle },
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
        const Icon = item.icon;
        return (
          <Link href={item.href} key={item.href} aria-current={current ? "page" : undefined}>
            <span className="mobile-role-nav__icon" aria-hidden="true"><Icon size={18} /></span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
