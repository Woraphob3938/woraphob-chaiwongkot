"use client";

import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { ProfileIdentity } from "@/components/profile-identity";
import { MemberProfileForm } from "@/components/member-profile-form";
import { TrainerPhotosManager } from "@/components/trainer-photos-manager";
import { TrainerApplyForm } from "@/components/trainer-apply-form";
import { TrainerProfileSummary } from "@/components/trainer-profile-summary";
import { PasswordForm } from "@/components/password-form";
import { ProfileTrainersPanel } from "@/components/profile-trainers-panel";
import { Input } from "@/components/ui/input";
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
import { clearStoredSession, profileImageStorageKey, readStoredUser } from "@/lib/session";
import type { AccountProfile } from "@/lib/types";

type ProfileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: AccountProfile };

type ProfileTab = "personal" | "trainers" | "security" | "delete";

const allTabs: { id: ProfileTab; label: string }[] = [
  { id: "personal", label: "ข้อมูลส่วนตัว" },
  { id: "trainers", label: "เทรนเนอร์" },
  { id: "security", label: "รหัสผ่าน" },
  { id: "delete", label: "ลบบัญชี" },
];

export function ProfileWorkbench() {
  const router = useRouter();
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<ProfileTab>("personal");
  const [trainerEditing, setTrainerEditing] = useState(false);
  const [personalDirty, setPersonalDirty] = useState(false);
  const [securityDirty, setSecurityDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<ProfileTab | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [accountDeleted, setAccountDeleted] = useState(false);

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

  // Only members browse trainers from here; trainers manage their own profile.
  function visibleTabs() {
    const isMember = state.status === "ready" && state.profile.role === "member";
    return allTabs.filter((tab) => tab.id !== "trainers" || isMember);
  }

  function requestTab(next: ProfileTab) {
    if (next === activeTab) return;
    const leavingDirty = activeTab === "personal" ? personalDirty : activeTab === "security" ? securityDirty : false;
    if (leavingDirty) {
      setPendingTab(next);
      return;
    }
    setActiveTab(next);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: ProfileTab) {
    const tabs = visibleTabs();
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
      requestTab("delete");
      document.getElementById("profile-delete-tab")?.focus();
    }
  }

  async function deleteAccount() {
    if (state.status !== "ready" || deletePending) return;
    setDeletePending(true);
    setDeleteError("");
    try {
      await authenticatedRequest<{ deleted: boolean }>("/v1/profile", {
        method: "DELETE",
        body: JSON.stringify({ currentPassword: deletePassword, confirmation: deleteConfirmation }),
      });
      setDeletePassword("");
      setDeleteConfirmation("");
      try {
        const currentUser = readStoredUser();
        clearStoredSession();
        if (currentUser) localStorage.removeItem(profileImageStorageKey(currentUser.id));
        document.documentElement.dataset.fitconnectSession = "guest";
      } catch {
        // The server has revoked the session even if this browser blocks storage access.
      }
      window.dispatchEvent(new CustomEvent("fitconnect:auth", { detail: null }));
      setDeleteDialogOpen(false);
      setAccountDeleted(true);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "ลบบัญชีไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDeletePending(false);
    }
  }

  if (accountDeleted) {
    return (
      <main className="page-shell account-profile">
        <section className="profile-section profile-delete-complete" role="status">
          <h1>ลบบัญชีเรียบร้อยแล้ว</h1>
          <p>คุณออกจากระบบแล้ว ประวัติการจองและการชำระเงินที่จำเป็นยังคงอยู่ในระบบ</p>
          <button className="button button--accent" type="button" onClick={() => router.push("/")}>กลับหน้าแรก</button>
        </section>
      </main>
    );
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

  async function refreshProfileAfterTrainerSave() {
    try {
      updateProfile(await authenticatedRequest<AccountProfile>("/v1/profile"));
      setTrainerEditing(false);
      setPersonalDirty(false);
    } catch {
      // The application was saved; keep its success state and editor visible if refresh fails.
    }
  }

  return (
    <main className="page-shell account-profile">
      <ProfileIdentity profile={state.profile} onProfileChange={updateProfile} />
      <div className="profile-tabs" role="tablist" aria-label="ตั้งค่าโปรไฟล์">
        {visibleTabs().map((tab) => (
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
          : (
            <>
              {trainerEditing
                ? (
                  <TrainerApplyForm
                    embedded
                    onDirtyChange={setPersonalDirty}
                    onSaved={refreshProfileAfterTrainerSave}
                    onCancel={() => { setTrainerEditing(false); setPersonalDirty(false); }}
                  />
                )
                : <TrainerProfileSummary profile={state.profile} onEdit={() => setTrainerEditing(true)} />}
              <TrainerPhotosManager />
            </>
          )}
      </div>
      {state.profile.role === "member" && (
        <div
          id="profile-trainers-panel"
          role="tabpanel"
          aria-labelledby="profile-trainers-tab"
          hidden={activeTab !== "trainers"}
        >
          {activeTab === "trainers" && <ProfileTrainersPanel />}
        </div>
      )}
      <div
        id="profile-security-panel"
        role="tabpanel"
        aria-labelledby="profile-security-tab"
        hidden={activeTab !== "security"}
      >
        <PasswordForm onDirtyChange={setSecurityDirty} />
      </div>
      <div
        id="profile-delete-panel"
        role="tabpanel"
        aria-labelledby="profile-delete-tab"
        hidden={activeTab !== "delete"}
      >
        <section className="profile-section profile-delete-account" aria-labelledby="delete-account-title">
          <div className="profile-section__heading">
            <h2 id="delete-account-title">ลบบัญชี</h2>
            <p>ปิดการเข้าใช้งานบัญชีนี้อย่างถาวร</p>
          </div>
          <div className="profile-delete-account__notice">
            <CircleAlert aria-hidden="true" size={20} />
            <div>
              <strong>ก่อนยืนยัน โปรดทราบว่า</strong>
              <p>คุณจะเข้าสู่ระบบบัญชีนี้ไม่ได้อีก ประวัติการจองและการชำระเงินที่จำเป็นยังคงอยู่เพื่อความถูกต้องของระบบ</p>
            </div>
          </div>
          <div>
            <button className="button button--danger" type="button" onClick={() => { setDeleteError(""); setDeleteDialogOpen(true); }}>
              <Trash2 aria-hidden="true" size={17} /> ลบบัญชีของฉัน
            </button>
          </div>
        </section>
      </div>
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
        if (!deletePending) {
          setDeleteDialogOpen(open);
          if (!open) {
            setDeletePassword("");
            setDeleteConfirmation("");
            setDeleteError("");
          }
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการลบบัญชี</DialogTitle>
            <DialogDescription>การลบบัญชีจะออกจากระบบทุกอุปกรณ์ และไม่สามารถกู้คืนจากหน้านี้ได้</DialogDescription>
          </DialogHeader>
          <div className="profile-delete-confirm-fields">
            <div className="field">
              <label htmlFor="delete-account-password">รหัสผ่านปัจจุบัน</label>
              <Input id="delete-account-password" type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="delete-account-confirmation">พิมพ์ “ลบบัญชี” เพื่อยืนยัน</label>
              <Input id="delete-account-confirmation" autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
            </div>
            {deleteError && <p className="profile-field-error" role="alert">{deleteError}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <button className="button" type="button" disabled={deletePending}>ยกเลิก</button>
            </DialogClose>
            <button
              className="button button--danger"
              type="button"
              disabled={deletePending || !deletePassword || deleteConfirmation !== "ลบบัญชี"}
              onClick={() => void deleteAccount()}
            >
              {deletePending ? <><LoaderCircle className="spin" aria-hidden="true" size={17} /> กำลังลบบัญชี</> : <><Trash2 aria-hidden="true" size={17} /> ยืนยันลบบัญชี</>}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
