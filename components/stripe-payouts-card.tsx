"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Landmark, RefreshCw } from "lucide-react";
import { authenticatedRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";

export type StripePayoutStatus = {
  configured: boolean;
  testMode: boolean;
  connected: boolean;
  payoutsReady: boolean;
};

type LinkResponse = { url: string };

/**
 * Where a freelance trainer connects their own Stripe account. Members pay
 * that account directly and FitConnect keeps its fee. Identity checks and bank
 * details are collected by Stripe on its own pages; FitConnect never sees them.
 */
export function StripePayoutsCard({ redirect = (url) => window.location.assign(url) }: {
  redirect?: (url: string) => void;
}) {
  const [status, setStatus] = useState<StripePayoutStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"load" | "onboard" | "dashboard" | null>("load");

  const fetchStatus = useCallback(() => Promise.resolve(authenticatedRequest<StripePayoutStatus>("/v1/trainer/stripe"))
    .then((next) => { setStatus(next ?? null); setError(""); })
    .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "โหลดสถานะบัญชีรับเงินไม่สำเร็จ"))
    .finally(() => setBusy(null)), []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  function load() {
    setBusy("load");
    void fetchStatus();
  }

  async function follow(kind: "onboard" | "dashboard") {
    setBusy(kind);
    setError("");
    try {
      const link = await authenticatedRequest<LinkResponse>(
        kind === "onboard" ? "/v1/trainer/stripe/onboarding" : "/v1/trainer/stripe/dashboard",
        { method: "POST" },
      );
      redirect(link.url);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "เปิดหน้า Stripe ไม่สำเร็จ");
      setBusy(null);
    }
  }

  const summary = !status
    ? "กำลังตรวจสถานะ…"
    : !status.configured
      ? "ระบบชำระเงินออนไลน์ยังไม่ได้ตั้งค่า"
      : status.payoutsReady
        ? "พร้อมรับเงิน สมาชิกชำระการจองแบบฟรีแลนซ์เข้าบัญชี Stripe ของคุณ หักค่าธรรมเนียมแพลตฟอร์มแล้ว"
        : status.connected
          ? "ยังยืนยันตัวตนไม่เสร็จ สมาชิกยังชำระการจองแบบฟรีแลนซ์ของคุณไม่ได้"
          : "ยังไม่ได้เชื่อมบัญชี สมาชิกจะชำระการจองแบบฟรีแลนซ์ได้หลังคุณเชื่อมบัญชี";

  return (
    <section className="trainer-finance profile-group" aria-labelledby="stripe-payouts-title" aria-busy={busy !== null}>
      <header className="section-line-heading">
        <div>
          <h2 id="stripe-payouts-title"><Landmark aria-hidden="true" size={18} /> บัญชีรับเงิน</h2>
          <p>รับค่าฝึกผ่าน Stripe{status?.testMode ? " (โหมดทดสอบ)" : ""}</p>
        </div>
        <span className="queue-count">{status?.payoutsReady ? "พร้อมรับเงิน" : "ยังไม่พร้อม"}</span>
      </header>
      <p className="booking-next-step" role="status">{summary}</p>
      {error && (
        <div className="workbench-error" role="alert">
          <span>{error}</span>
          <button type="button" disabled={busy !== null} onClick={load}>
            <RefreshCw aria-hidden="true" size={15} /> ลองใหม่
          </button>
        </div>
      )}
      {status?.configured && (
        <div className="queue-actions">
          {!status.payoutsReady && (
            <Button className="button button--accent" type="button" disabled={busy !== null} onClick={() => void follow("onboard")}>
              {busy === "onboard" ? "กำลังเปิด Stripe…" : status.connected ? "ยืนยันตัวตนต่อ" : "เชื่อมบัญชีรับเงิน"}
            </Button>
          )}
          {status.connected && (
            <Button className="button" type="button" disabled={busy !== null} onClick={() => void follow("dashboard")}>
              <ExternalLink aria-hidden="true" size={16} /> {busy === "dashboard" ? "กำลังเปิด…" : "เปิด Stripe Dashboard"}
            </Button>
          )}
        </div>
      )}
      <p className="profile-group__hint">
        การจองแบบประจำยิมชำระเข้าบัญชีของแพลตฟอร์มและผู้ดูแลระบบของยิมเป็นผู้สรุปรายได้ จึงไม่ต้องใช้บัญชีนี้
      </p>
    </section>
  );
}
