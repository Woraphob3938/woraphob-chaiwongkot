import type { UserRole } from "@/lib/types";

export type NavigationIcon = "home" | "search" | "bookings" | "workspace" | "notifications" | "chat" | "profile" | "login" | "register";

export type RoleNavigationItem = {
  href: string;
  label: string;
  icon: NavigationIcon;
  desktop: boolean;
  mobile: boolean;
};

const navigationByAudience: Record<"guest" | UserRole, RoleNavigationItem[]> = {
  guest: [
    { href: "/", label: "หน้าแรก", icon: "home", desktop: false, mobile: true },
    { href: "/login", label: "เข้าสู่ระบบ", icon: "login", desktop: false, mobile: true },
    { href: "/register", label: "สมัครสมาชิก", icon: "register", desktop: false, mobile: true },
  ],
  member: [
    { href: "/trainers", label: "ค้นหาเทรนเนอร์", icon: "search", desktop: true, mobile: true },
    { href: "/member", label: "การจองของฉัน", icon: "bookings", desktop: true, mobile: true },
    { href: "/notifications", label: "การแจ้งเตือน", icon: "notifications", desktop: true, mobile: true },
    { href: "/chat", label: "แชต", icon: "chat", desktop: true, mobile: true },
    { href: "/profile", label: "โปรไฟล์", icon: "profile", desktop: true, mobile: true },
  ],
  trainer: [
    { href: "/trainer", label: "พื้นที่เทรนเนอร์", icon: "workspace", desktop: true, mobile: true },
    { href: "/notifications", label: "การแจ้งเตือน", icon: "notifications", desktop: true, mobile: true },
    { href: "/chat", label: "แชต", icon: "chat", desktop: true, mobile: true },
    { href: "/profile", label: "โปรไฟล์", icon: "profile", desktop: true, mobile: true },
  ],
  admin: [
    { href: "/admin", label: "พื้นที่ผู้ดูแลระบบ", icon: "workspace", desktop: true, mobile: true },
  ],
};

export function navigationFor(role: UserRole | null): RoleNavigationItem[] {
  return navigationByAudience[role ?? "guest"];
}
