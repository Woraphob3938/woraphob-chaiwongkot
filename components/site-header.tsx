"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CalendarCheck2,
  ChevronDown,
  Dumbbell,
  Home,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { MobileRoleNav } from "@/components/mobile-role-nav";
import { ApiError, apiAssetUrl, apiRequest } from "@/lib/api";
import { navigationFor, type NavigationIcon } from "@/lib/role-navigation";
import type { AuthenticatedUser, UserRole } from "@/lib/types";

const validRoles: Record<UserRole, true> = {
  member: true,
  trainer: true,
  admin: true,
};

const sidebarIcons: Partial<Record<NavigationIcon, LucideIcon>> = {
  home: Home,
  search: Search,
  bookings: CalendarCheck2,
  workspace: LayoutDashboard,
  chat: MessageCircle,
  profile: UserRound,
};

function isCurrentDestination(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function userInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "FC";
  return parts.slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("th-TH");
}

function readStoredUser() {
  const stored = localStorage.getItem("fitconnect_user");
  if (!stored) return null;
  try {
    const user = JSON.parse(stored) as Partial<AuthenticatedUser>;
    if (
      typeof user.id !== "number"
      || typeof user.email !== "string"
      || typeof user.displayName !== "string"
      || !user.role
      || !(user.role in validRoles)
    ) {
      throw new Error("Invalid stored user");
    }
    return user as AuthenticatedUser;
  } catch {
    localStorage.removeItem("fitconnect_user");
    return null;
  }
}

function profileImageKey(userId: number) {
  return `fitconnect_profile_image_${userId}`;
}

function AccountAvatar({ user }: { user: AuthenticatedUser }) {
  const [failed, setFailed] = useState(false);
  const source = apiAssetUrl(user.imageUrl ?? null);
  return (
    <span className="profile-avatar" aria-hidden="true">
      {source && !failed
        ? <Image src={source} alt="" width={36} height={36} unoptimized onError={() => setFailed(true)} />
        : userInitials(user.displayName)}
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const profileRevisionRef = useRef(0);

  useLayoutEffect(() => {
    const hasStoredSession = Boolean(
      localStorage.getItem("fitconnect_token") && localStorage.getItem("fitconnect_user"),
    );
    document.documentElement.dataset.fitconnectSession = hasStoredSession ? "authenticated" : "guest";
  }, []);

  useEffect(() => {
    let active = true;

    async function syncSession(event?: Event) {
      const eventUser = event instanceof CustomEvent ? event.detail as AuthenticatedUser | null : null;
      const token = localStorage.getItem("fitconnect_token");
      const storedUser = eventUser ?? readStoredUser();

      if (!token) {
        if (active) {
          setUser(null);
          setSessionReady(true);
        }
        return;
      }

      if (storedUser && active) {
        setUser(storedUser);
        setSessionReady(true);
      }

      try {
        const profileRevision = profileRevisionRef.current;
        const currentUser = await apiRequest<AuthenticatedUser>("/v1/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!active) return;
        const updatedStoredUser = readStoredUser();
        const imageUrl = localStorage.getItem(profileImageKey(currentUser.id));
        const synchronizedUser = {
          ...currentUser,
          displayName: profileRevisionRef.current === profileRevision
            ? currentUser.displayName
            : updatedStoredUser?.displayName ?? currentUser.displayName,
          imageUrl,
        };
        localStorage.setItem("fitconnect_user", JSON.stringify(synchronizedUser));
        setUser(synchronizedUser);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          localStorage.removeItem("fitconnect_token");
          localStorage.removeItem("fitconnect_user");
          setUser(null);
        } else {
          setUser(storedUser);
        }
      } finally {
        if (active) setSessionReady(true);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }

    function onProfileUpdated(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { displayName?: unknown; imageUrl?: unknown };
      if (typeof detail.displayName !== "string") return;
      const displayName = detail.displayName;
      profileRevisionRef.current += 1;
      setUser((currentUser) => {
        if (!currentUser) return currentUser;
        const imageUrl = typeof detail.imageUrl === "string" ? detail.imageUrl : null;
        const nextUser = { ...currentUser, displayName, imageUrl };
        localStorage.setItem("fitconnect_user", JSON.stringify(nextUser));
        if (imageUrl) localStorage.setItem(profileImageKey(currentUser.id), imageUrl);
        else localStorage.removeItem(profileImageKey(currentUser.id));
        return nextUser;
      });
    }

    void syncSession();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("storage", syncSession);
    window.addEventListener("fitconnect:auth", syncSession);
    window.addEventListener("fitconnect:profile-updated", onProfileUpdated);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("storage", syncSession);
      window.removeEventListener("fitconnect:auth", syncSession);
      window.removeEventListener("fitconnect:profile-updated", onProfileUpdated);
    };
  }, []);

  useEffect(() => {
    function expandSidebarAfterPageShow() {
      setSidebarCollapsed(false);
    }

    window.addEventListener("pageshow", expandSidebarAfterPageShow);
    return () => window.removeEventListener("pageshow", expandSidebarAfterPageShow);
  }, []);

  useEffect(() => {
    if (user?.role !== "member" || pathname === "/trainers") return;

    function openMemberSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dialogRef.current?.showModal();
      }
    }

    window.addEventListener("keydown", openMemberSearch);
    return () => window.removeEventListener("keydown", openMemberSearch);
  }, [pathname, user?.role]);

  async function signOut() {
    const token = localStorage.getItem("fitconnect_token");
    try {
      if (token) {
        await apiRequest("/v1/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      // Local sign-out must still work when the API is temporarily unavailable.
    } finally {
      localStorage.removeItem("fitconnect_token");
      localStorage.removeItem("fitconnect_user");
      if (user) localStorage.removeItem(profileImageKey(user.id));
      document.documentElement.dataset.fitconnectSession = "guest";
      setUser(null);
      setProfileOpen(false);
      window.dispatchEvent(new CustomEvent("fitconnect:auth", { detail: null }));
      router.push("/");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const query = String(data.get("q") ?? "").trim();
    if (!query) event.preventDefault();
  }

  const memberSearchEnabled = user?.role === "member" && pathname !== "/trainers";
  const desktopNavItems = navigationFor(user?.role ?? null).filter((item) => item.desktop);
  const guestHeader = (
    <header className={`site-header${sessionReady ? "" : " site-header--pending"}`}>
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="FitConnect หน้าหลัก">
          <span className="brand-mark" aria-hidden="true"><Dumbbell size={19} strokeWidth={2.2} /></span>
          <span>FITCONNECT</span>
        </Link>
        <div className="header-actions">
          {!sessionReady ? (
            <span className="session-placeholder" aria-hidden="true" />
          ) : (
            <>
              <Link className="text-link desktop-only" href="/login">เข้าสู่ระบบ</Link>
              <Link className="button button--dark desktop-only" href="/register">เริ่มใช้งาน</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );

  return (
    <>
      {!sessionReady && (
        <aside className="session-sidebar-placeholder" aria-hidden="true">
          <div className="app-sidebar__top">
            <span className="brand">
              <span className="brand-mark"><Dumbbell size={19} strokeWidth={2.2} /></span>
              <span className="brand__label">FITCONNECT</span>
            </span>
          </div>
          <div className="session-sidebar-placeholder__nav">
            <span /><span /><span />
          </div>
          <div className="session-sidebar-placeholder__account">
            <span className="profile-avatar" />
            <span />
          </div>
        </aside>
      )}
      {sessionReady && user ? (
        <aside className="app-sidebar" aria-label="แถบนำทาง FitConnect" data-collapsed={sidebarCollapsed}>
          <div className="app-sidebar__top">
            <Link className="brand" href="/" aria-label="FitConnect หน้าหลัก">
              <span className="brand-mark" aria-hidden="true"><Dumbbell size={19} strokeWidth={2.2} /></span>
              <span className="brand__label">FITCONNECT</span>
            </Link>
            <button
              className="app-sidebar__toggle icon-button"
              type="button"
              aria-label={sidebarCollapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              {sidebarCollapsed
                ? <PanelLeftOpen aria-hidden="true" size={19} />
                : <PanelLeftClose aria-hidden="true" size={19} />}
            </button>
          </div>

          <nav className="desktop-nav" aria-label="เมนูหลักด้านข้าง">
            {desktopNavItems.map((item) => {
              const Icon = sidebarIcons[item.icon] ?? Home;
              const current = isCurrentDestination(pathname, item.href);
              return (
                <Link
                  href={item.href}
                  key={item.href}
                  aria-current={current ? "page" : undefined}
                  aria-label={item.label}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <span className="app-sidebar__nav-icon" aria-hidden="true"><Icon size={19} /></span>
                  <span className="app-sidebar__nav-label">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="app-sidebar__account">
            <div className="profile-session" ref={profileRef}>
              <button
                className="profile-trigger"
                type="button"
                aria-label={`เปิดเมนูบัญชีของ ${user.displayName || "บัญชีของฉัน"}`}
                aria-expanded={profileOpen}
                aria-controls="profile-account-menu"
                onClick={() => setProfileOpen((open) => !open)}
              >
                <AccountAvatar key={user.imageUrl ?? "fallback"} user={user} />
                <span className="profile-trigger__name">{user.displayName || "บัญชีของฉัน"}</span>
                <ChevronDown className={profileOpen ? "is-open" : ""} aria-hidden="true" size={16} />
              </button>
              {profileOpen && (
                <div className="profile-menu" id="profile-account-menu">
                  <div className="profile-menu__identity">
                    <AccountAvatar key={user.imageUrl ?? "fallback-menu"} user={user} />
                    <span><strong>{user.displayName || "บัญชีของฉัน"}</strong><small>{user.email}</small></span>
                  </div>
                  <Link href="/profile" onClick={() => setProfileOpen(false)}>
                    <UserRound aria-hidden="true" size={17} /> ดูโปรไฟล์
                  </Link>
                  <button type="button" onClick={() => void signOut()}>
                    <LogOut aria-hidden="true" size={17} /> ออกจากระบบ
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      ) : guestHeader}

      {memberSearchEnabled && <dialog className="search-dialog" ref={dialogRef} onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}>
        <div className="search-dialog__panel">
          <div className="dialog-heading">
            <div>
              <p className="label">ค้นหาทั่ว FitConnect</p>
              <h2>เริ่มจากสิ่งที่คุณต้องการฝึก</h2>
            </div>
            <button className="icon-button" type="button" aria-label="ปิดหน้าต่างค้นหา" onClick={() => dialogRef.current?.close()}>
              <X aria-hidden="true" />
            </button>
          </div>
          <form action="/trainers" method="get" className="dialog-search-form" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={21} />
            <label className="sr-only" htmlFor="global-search">คำค้นหา</label>
            <input id="global-search" name="q" autoFocus placeholder="เช่น เวทเทรนนิง หรือชื่อเทรนเนอร์" />
            <button className="button button--accent" type="submit">ค้นหา</button>
          </form>
          <div className="search-suggestions" aria-label="คำค้นหาแนะนำ">
              <span>ลองค้นหา</span>
              <Link href="/trainers?type=strength">เวทเทรนนิง</Link>
              <Link href="/trainers?type=mobility">การเคลื่อนไหว</Link>
          </div>
        </div>
      </dialog>}
      {sessionReady && <MobileRoleNav user={user} />}
    </>
  );
}
