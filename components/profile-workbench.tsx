"use client";

import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { ProfileIdentity } from "@/components/profile-identity";
import { MemberProfileForm } from "@/components/member-profile-form";
import { TrainerAccountForm } from "@/components/trainer-account-form";
import { PasswordForm } from "@/components/password-form";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authenticatedRequest } from "@/lib/api";
import type { AccountProfile } from "@/lib/types";

type ProfileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: AccountProfile };

type ProfileTab = "personal" | "security";

const tabs: { id: ProfileTab; label: string }[] = [
  { id: "personal", label: "ข้อมูลส่วนตัว" },
  { id: "security", label: "รหัสผ่าน" },
];

export function ProfileWorkbench() {
  const router = useRouter();
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<ProfileTab>("personal");
  const [personalDirty, setPersonalDirty] = useState(false);
  const [securityDirty, setSecurityDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<ProfileTab | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const profile = await authenticatedRequest<AccountProfile>("/v1/profile");
      setState({ status: "ready", profile });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "โหลดโปรไฟล์ไม่สำเร็จ",
      });
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("fitconnect_token");
    if (!token) {
      router.push("/login");
      return;
    }
    const stored = localStorage.getItem("fitconnect_user");
    if (stored) {
      try {
        const user = JSON.parse(stored) as { role?: string };
        if (user.role === "admin") {
          router.push("/admin");
          return;
        }
      } catch {
        localStorage.removeItem("fitconnect_user");
      }
    }
    const timeoutId = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadProfile, router]);

  useEffect(() => {
    if (!personalDirty && !securityDirty) return;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(`${url.pathname}${url.search}${url.hash}`);
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, [personalDirty, securityDirty]);

  function requestTab(next: ProfileTab) {
    if (next === activeTab) return;
    const leavingDirty = activeTab === "personal" ? personalDirty : securityDirty;
    if (leavingDirty) {
      setPendingTab(next);
      return;
    }
    setActiveTab(next);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: ProfileTab) {
    const index = tabs.findIndex((item) => item.id === tab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      requestTab(next.id);
      document.getElementById(`profile-${next.id}-tab`)?.focus();
    }
    if (event.key === "Home") {
      event.preventDefault();
      requestTab("personal");
      document.getElementById("profile-personal-tab")?.focus();
    }
    if (event.key === "End") {
      event.preventDefault();
      requestTab("security");
      document.getElementById("profile-security-tab")?.focus();
    }
  }

  if (state.status === "loading") {
    return (
      <main className="page-shell account-profile">
        <div className="workbench-loading" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={20} /> กำลังโหลดโปรไฟล์
        </div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="page-shell account-profile">
        <div className="workbench-error" role="alert">
          <CircleAlert aria-hidden="true" size={20} />
          <p>{state.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              void loadProfile();
            }}
          >
            <RefreshCw aria-hidden="true" size={17} /> ลองใหม่
          </button>
        </div>
      </main>
    );
  }

  function updateProfile(profile: AccountProfile) {
    setState({ status: "ready", profile });
    window.dispatchEvent(new CustomEvent("fitconnect:profile-updated", {
      detail: { displayName: profile.user.displayName, imageUrl: profile.imageUrl },
    }));
  }

  return (
    <main className="page-shell account-profile">
      <ProfileIdentity profile={state.profile} onProfileChange={updateProfile} />
      <div className="profile-tabs" role="tablist" aria-label="ตั้งค่าโปรไฟล์">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`profile-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`profile-${tab.id}-panel`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => requestTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id="profile-personal-panel"
        role="tabpanel"
        aria-labelledby="profile-personal-tab"
        hidden={activeTab !== "personal"}
      >
        {state.profile.role === "member"
          ? <MemberProfileForm profile={state.profile} onSaved={updateProfile} onDirtyChange={setPersonalDirty} />
          : <TrainerAccountForm profile={state.profile} onSaved={updateProfile} onDirtyChange={setPersonalDirty} />}
      </div>
      <div
        id="profile-security-panel"
        role="tabpanel"
        aria-labelledby="profile-security-tab"
        hidden={activeTab !== "security"}
      >
        <PasswordForm onDirtyChange={setSecurityDirty} />
      </div>
      <Dialog open={pendingTab !== null} onOpenChange={(open) => { if (!open) setPendingTab(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>มีข้อมูลที่ยังไม่บันทึก</DialogTitle>
            <DialogDescription>ถ้าสลับแท็บตอนนี้ ข้อความที่พิมพ์ยังอยู่ แต่ยังไม่ได้บันทึกลงระบบ</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button className="button" type="button">อยู่หน้านี้</button>
            </DialogClose>
            <button
              className="button button--accent"
              type="button"
              onClick={() => {
                if (pendingTab) setActiveTab(pendingTab);
                setPendingTab(null);
              }}
            >
              สลับแท็บ
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={pendingNavigation !== null} onOpenChange={(open) => { if (!open) setPendingNavigation(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ออกจากหน้าโดยยังไม่บันทึก?</DialogTitle>
            <DialogDescription>การแก้ไขล่าสุดจะหายไปหากออกจากหน้าโปรไฟล์ตอนนี้</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button className="button" type="button">กลับไปบันทึก</button>
            </DialogClose>
            <button
              className="button button--danger"
              type="button"
              onClick={() => {
                const href = pendingNavigation;
                setPersonalDirty(false);
                setSecurityDirty(false);
                setPendingNavigation(null);
                if (href) router.push(href);
              }}
            >
              ออกโดยไม่บันทึก
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
