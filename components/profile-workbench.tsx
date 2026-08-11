"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { authenticatedRequest } from "@/lib/api";
import type { AccountProfile } from "@/lib/types";

type ProfileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: AccountProfile };

export function ProfileWorkbench() {
  const router = useRouter();
  const [state, setState] = useState<ProfileState>({ status: "loading" });

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
            className="button button--secondary"
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

  return (
    <main className="page-shell account-profile">
      <h1>{state.profile.role === "member" ? "โปรไฟล์สมาชิก" : "โปรไฟล์เทรนเนอร์"}</h1>
    </main>
  );
}
