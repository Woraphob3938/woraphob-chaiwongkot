"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarCheck2,
  Home,
  LayoutDashboard,
  LogIn,
  MessageCircle,
  Search,
  UserRound,
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
  notifications: Bell,
  chat: MessageCircle,
  profile: UserRound,
  login: LogIn,
  register: UserPlus,
};

const compactLabels: Partial<Record<NavigationIcon, string>> = {
  search: "ค้นหา",
  bookings: "การจอง",
  workspace: "พื้นที่งาน",
  notifications: "แจ้งเตือน",
};

function isCurrentDestination(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileRoleNav({
  user,
  notificationUnreadCount = 0,
}: {
  user: AuthenticatedUser | null;
  notificationUnreadCount?: number;
}) {
  const pathname = usePathname();
  const items = navigationFor(user?.role ?? null).filter((item) => item.mobile);

  return (
    <nav className="mobile-role-nav" aria-label="เมนูหลักบนมือถือ">
      {items.map((item) => {
        const current = isCurrentDestination(pathname, item.href);
        const Icon = icons[item.icon];
        return (
          <Link href={item.href} key={item.href} aria-current={current ? "page" : undefined} aria-label={item.label}>
            <span className="mobile-role-nav__icon" aria-hidden="true">
              <Icon size={18} />
              {item.icon === "notifications" && notificationUnreadCount > 0 && (
                <span className="mobile-role-nav__badge">{notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}</span>
              )}
            </span>
            <span className="mobile-role-nav__label" data-short-label={compactLabels[item.icon] ?? item.label}>{item.label}</span>
            {item.icon === "notifications" && notificationUnreadCount > 0 && (
              <span className="sr-only">มีการแจ้งเตือนที่ยังไม่ได้อ่าน {notificationUnreadCount} รายการ</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
