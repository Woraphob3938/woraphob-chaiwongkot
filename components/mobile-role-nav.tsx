"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck2,
  Home,
  LayoutDashboard,
  LogIn,
  MessageCircle,
  Search,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { navigationFor, type NavigationIcon } from "@/lib/role-navigation";
import type { AuthenticatedUser } from "@/lib/types";

const icons: Record<NavigationIcon, LucideIcon> = {
  home: Home,
  search: Search,
  bookings: CalendarCheck2,
  workspace: LayoutDashboard,
  chat: MessageCircle,
  login: LogIn,
  register: UserPlus,
};

function isCurrentDestination(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileRoleNav({ user }: { user: AuthenticatedUser | null }) {
  const pathname = usePathname();
  const items = navigationFor(user?.role ?? null).filter((item) => item.mobile);

  return (
    <nav className="mobile-role-nav" aria-label="เมนูหลักบนมือถือ">
      {items.map((item) => {
        const current = isCurrentDestination(pathname, item.href);
        const Icon = icons[item.icon];
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
