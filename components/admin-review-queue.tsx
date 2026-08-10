"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest, openProtectedFile } from "@/lib/api";
import { getAdminNextAction } from "@/lib/dashboard-actions";
import { formatDateTime } from "@/lib/format";
import type { AdminQueue } from "@/lib/types";

const paymentCurrency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
});

const wrapAnywhereStyle = {
  display: "block",
  minWidth: 0,
  maxWidth: "100%",
  overflowWrap: "anywhere",
} as const;

function formatPaymentAmount(value: number | null) {
  return value === null ? "ไม่มียอดที่บันทึก" : paymentCurrency.format(value);
}

function formatPaymentDifference(value: number | null) {
  if (value === null) return "คำนวณส่วนต่างไม่ได้";
  return value > 0 ? `+${paymentCurrency.format(value)}` : paymentCurrency.format(value);
}

function leaveExpiredSession(error: unknown, navigate: (href: string) => void) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  localStorage.removeItem("fitconnect_token");
  navigate("/login");
  return true;
}

type PaymentDecisionResponse = {
  bookingStatus: "awaiting_payment" | "confirmed" | "expired";
  paymentDeadlineAt: string | null;
};

export function AdminReviewQueue() {
  const router = useRouter();
  const navigate = router.push;
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [paymentNotes, setPaymentNotes] = useState<Record<number, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [resolvedPayments, setResolvedPayments] = useState<Record<number, true>>({});
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyRows, setBusyRows] = useState<Record<string, "file" | "approve" | "reject" | "refresh">>({});
  const [loading, setLoading] = useState(true);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const queueRequestRef = useRef(0);

  function startRowTask(rowKey: string, action: "file" | "approve" | "reject" | "refresh") {
    setBusyRows((current) => ({ ...current, [rowKey]: action }));
  }

  function finishRowTask(rowKey: string) {
    setBusyRows((current) => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
  }

  const loadQueue = useCallback(async () => {
    const requestId = ++queueRequestRef.current;
    setLoadError("");
    setLoading(true);
    try {
      const nextQueue = await authenticatedRequest<AdminQueue>("/v1/admin/review-queue");
      if (requestId !== queueRequestRef.current) return "superseded" as const;
      setQueue(nextQueue);
      setResolvedPayments((current) => {
        const next = { ...current };
        for (const id of Object.keys(next)) {
          if (!nextQueue.payments.some((payment) => payment.id === Number(id))) delete next[Number(id)];
        }
        return next;
      });
      return "applied" as const;
    } catch (error) {
      if (requestId !== queueRequestRef.current) return "superseded" as const;
      if (leaveExpiredSession(error, navigate)) return "failed" as const;
      setLoadError(error instanceof Error ? error.message : "โหลดคิวตรวจสอบไม่สำเร็จ");
      return "failed" as const;
    } finally {
      if (requestId === queueRequestRef.current) setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  async function openFile(path: string, rowKey: string) {
    if (busyRows[rowKey]) return;
    startRowTask(rowKey, "file");
    setRowErrors((current) => ({ ...current, [rowKey]: "" }));
    try {
      await openProtectedFile(path);
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setRowErrors((current) => ({
        ...current,
        [rowKey]: error instanceof Error ? error.message : "เปิดไฟล์ไม่สำเร็จ",
      }));
    } finally {
      finishRowTask(rowKey);
    }
  }

  async function decideTrainer(trainerId: number, decision: "approve" | "reject") {
    const rowKey = `trainer-${trainerId}`;
    if (busyRows[rowKey]) return;
    const note = notes[trainerId]?.trim() ?? "";
    const trainerName = queue?.trainers.find((trainer) => trainer.id === trainerId)?.displayName ?? `TR-${String(trainerId).padStart(6, "0")}`;
    if (decision === "reject" && !note) {
      setRowErrors((current) => ({ ...current, [rowKey]: "กรุณาระบุเหตุผลก่อนปฏิเสธ" }));
      return;
    }

    startRowTask(rowKey, decision);
    setNotice("");
    setRowErrors((current) => ({ ...current, [rowKey]: "" }));
    try {
      await authenticatedRequest(`/v1/admin/trainers/${trainerId}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      const refreshResult = await loadQueue();
      if (refreshResult === "applied") {
        setNotice(`${decision === "approve" ? "อนุมัติ" : "ปฏิเสธ"}ใบสมัคร${trainerName}แล้ว`);
      } else if (refreshResult === "failed") {
        setRowErrors((current) => ({ ...current, [rowKey]: "บันทึกผลแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้" }));
        setNotice(`บันทึกผลใบสมัคร${trainerName}แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้`);
      }
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      if (error instanceof ApiError && error.status === 409) {
        const refreshResult = await loadQueue();
        if (refreshResult === "applied") {
          setNotice("ผู้ดูแลคนอื่นบันทึกผลรายการนี้แล้ว โหลดคิวล่าสุดแล้ว");
        } else if (refreshResult === "failed") {
          setRowErrors((current) => ({ ...current, [rowKey]: "รายการนี้มีผลตรวจแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้" }));
          setNotice("ผู้ดูแลคนอื่นบันทึกผลรายการนี้แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้");
        }
      } else {
        const message = error instanceof Error ? error.message : "บันทึกผลไม่สำเร็จ";
        setRowErrors((current) => ({ ...current, [rowKey]: message }));
      }
    } finally {
      finishRowTask(rowKey);
    }
  }

  async function decidePayment(paymentId: number, decision: "approve" | "reject") {
    const rowKey = `payment-${paymentId}`;
    if (busyRows[rowKey] || resolvedPayments[paymentId]) return;
    const paymentCode = `PAY-${String(paymentId).padStart(6, "0")}`;
    const note = paymentNotes[paymentId]?.trim() ?? "";
    if (decision === "reject" && !note) {
      setRowErrors((current) => ({ ...current, [rowKey]: "กรุณาระบุเหตุผลที่สลิปไม่ผ่าน" }));
      return;
    }

    startRowTask(rowKey, decision);
    setNotice("");
    setRowErrors((current) => ({ ...current, [rowKey]: "" }));
    try {
      const result = await authenticatedRequest<PaymentDecisionResponse>(`/v1/admin/payments/${paymentId}/${decision}`, {
        method: "POST",
        body: JSON.stringify(decision === "approve" ? {} : { note }),
      });
      setResolvedPayments((current) => ({ ...current, [paymentId]: true }));
      const refreshResult = await loadQueue();
      if (refreshResult === "applied") {
        if (decision === "approve") {
          setNotice(`อนุมัติสลิป ${paymentCode} แล้ว`);
        } else if (result.bookingStatus === "expired") {
          setNotice(`สลิป ${paymentCode} ถูกปฏิเสธครั้งที่สองและคืนช่วงเวลาแล้ว`);
        } else {
          setNotice(`สลิป ${paymentCode} ไม่ผ่าน ให้สมาชิกส่งใหม่ภายใน 10 นาที`);
        }
      } else if (refreshResult === "failed") {
        setRowErrors((current) => ({ ...current, [rowKey]: "บันทึกผลแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้" }));
        setNotice(`บันทึกผลสลิป ${paymentCode} แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้`);
      }
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      if (error instanceof ApiError && error.status === 409) {
        setResolvedPayments((current) => ({ ...current, [paymentId]: true }));
        const refreshResult = await loadQueue();
        if (refreshResult === "applied") {
          setNotice("ผู้ดูแลคนอื่นบันทึกผลรายการนี้แล้ว โหลดคิวล่าสุดแล้ว");
        } else if (refreshResult === "failed") {
          setRowErrors((current) => ({ ...current, [rowKey]: "รายการนี้มีผลตรวจแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้" }));
          setNotice("ผู้ดูแลคนอื่นบันทึกผลรายการนี้แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้");
        }
      } else {
        const message = error instanceof Error ? error.message : "บันทึกผลไม่สำเร็จ กรุณาลองอีกครั้ง";
        setRowErrors((current) => ({ ...current, [rowKey]: message }));
      }
    } finally {
      finishRowTask(rowKey);
    }
  }

  async function retryPaymentRefresh(paymentId: number) {
    const rowKey = `payment-${paymentId}`;
    if (busyRows[rowKey]) return;
    startRowTask(rowKey, "refresh");
    setRowErrors((current) => ({ ...current, [rowKey]: "" }));
    const refreshResult = await loadQueue();
    if (refreshResult === "applied") {
      setNotice("โหลดคิวตรวจสอบล่าสุดแล้ว");
    } else if (refreshResult === "failed") {
      setRowErrors((current) => ({ ...current, [rowKey]: "ยังโหลดคิวล่าสุดไม่ได้ กรุณาลองอีกครั้ง" }));
    }
    finishRowTask(rowKey);
  }

  if (loading && !queue) {
    return <section className="queue-loading" aria-live="polite">กำลังโหลดคิวตรวจสอบ…</section>;
  }

  if (loadError && !queue) {
    return (
      <section className="queue-retry" role="alert">
        <strong>ยังเปิดคิวตรวจสอบไม่ได้</strong>
        <p>{loadError}</p>
        <button className="button button--dark" type="button" onClick={() => void loadQueue()}>
          <RefreshCw aria-hidden="true" size={17} /> ลองใหม่
        </button>
      </section>
    );
  }

  const currentQueue = queue ?? { trainers: [], payments: [] };

  return (
    <div className="admin-board">
      <NextActionCard action={getAdminNextAction(currentQueue)} />

      <section className="admin-summary" aria-label="สรุปคิวตรวจสอบ">
        <div><span>ใบสมัครรอตรวจ</span><strong>{String(currentQueue.trainers.length).padStart(2, "0")}</strong></div>
        <div><span>สลิปรอตรวจ</span><strong>{String(currentQueue.payments.length).padStart(2, "0")}</strong></div>
      </section>

      <section id="review-queue" className="verification-queue" aria-labelledby="review-queue-title">
        <div className="section-line-heading">
          <div><h2 id="review-queue-title">รายการที่ต้องตัดสินใจ</h2></div>
          <span>{loading ? "กำลังอัปเดต" : "ข้อมูลจากระบบ"}</span>
        </div>
        {notice && <p ref={noticeRef} className="queue-notice" role="status" tabIndex={-1}>{notice}</p>}

        <details className="admin-queue-disclosure">
          <summary>
            <span><strong>ใบสมัครเทรนเนอร์</strong><small>ตรวจคุณสมบัติและเอกสารรับรอง</small></span>
            <span>{currentQueue.trainers.length} รายการ</span>
          </summary>
          <div className="admin-queue-disclosure__content">
            {currentQueue.trainers.map((trainer) => {
          const rowKey = `trainer-${trainer.id}`;
          const isBusy = Boolean(busyRows[rowKey]);
          return (
            <article className="verification-row verification-row--trainer" key={rowKey} aria-busy={isBusy}>
              <div className="review-applicant">
                <span>TR-{String(trainer.id).padStart(6, "0")}</span>
                <strong>{trainer.displayName}</strong>
                <small>ส่งเมื่อ {formatDateTime(trainer.submittedAt)}</small>
                <ul className="certificate-list" aria-label={`เอกสารของ${trainer.displayName}`}>
                  {trainer.certificates.map((certificate) => (
                    <li key={certificate.id}>
                      <div>
                        <FileText aria-hidden="true" size={17} />
                        <span><strong>{certificate.name}</strong><small>{certificate.issuer} · {formatDateTime(certificate.submittedAt)}</small></span>
                      </div>
                      <button className="certificate-action" type="button" disabled={isBusy} onClick={() => void openFile(certificate.fileUrl, rowKey)}>
                        เปิด PDF
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="review-note">
                  <span>หมายเหตุสำหรับ{trainer.displayName}</span>
                  <textarea
                    value={notes[trainer.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [trainer.id]: event.target.value }))}
                    disabled={isBusy}
                    rows={3}
                    placeholder="ใช้แจ้งเหตุผลเมื่อปฏิเสธ หรือบันทึกประกอบการอนุมัติ"
                  />
                </label>
                {rowErrors[rowKey] && <p className="row-error" role="alert">{rowErrors[rowKey]}</p>}
              </div>
              <StatusBadge status="pending" />
              <div className="queue-actions">
                <button type="button" disabled={isBusy} onClick={() => void decideTrainer(trainer.id, "approve")}>{isBusy ? "กำลังบันทึก…" : "อนุมัติ"}</button>
                <button type="button" disabled={isBusy} onClick={() => void decideTrainer(trainer.id, "reject")}>ปฏิเสธ</button>
              </div>
            </article>
          );
        })}

          {currentQueue.trainers.length === 0 && (
            <div className="empty-state"><strong>ไม่มีใบสมัครเทรนเนอร์รอตรวจ</strong></div>
          )}
          </div>
        </details>

        <details className="admin-queue-disclosure">
          <summary>
            <span><strong>หลักฐานการชำระเงิน</strong><small>ตรวจยอดและหลักฐานการโอน</small></span>
            <span>{currentQueue.payments.length} รายการ</span>
          </summary>
          <div className="admin-queue-disclosure__content">
            {currentQueue.payments.map((payment) => {
          const rowKey = `payment-${payment.id}`;
          const paymentCode = `PAY-${String(payment.id).padStart(6, "0")}`;
          const busyAction = busyRows[rowKey];
          const isBusy = Boolean(busyAction);
          const isResolved = Boolean(resolvedPayments[payment.id]);
          const appointment = `${formatDateTime(payment.startsAt)} ถึง ${formatDateTime(payment.endsAt)}`;
          const evidence = [
            ["สมาชิก", payment.memberName],
            ["เทรนเนอร์", payment.trainerName],
            ["วันและเวลานัด", appointment],
            ["ค่าฝึกต่อครั้ง", formatPaymentAmount(payment.quotedPrice)],
            ["ยอดที่โอน", formatPaymentAmount(payment.amount)],
            ["ส่วนต่าง", formatPaymentDifference(payment.difference)],
            ["ส่งหลักฐานเมื่อ", formatDateTime(payment.submittedAt)],
            ["สถานะ", "รอตรวจหลักฐาน"],
          ];
          return (
            <article
              className="verification-row verification-row--trainer"
              key={rowKey}
              aria-label={`ตรวจสลิป ${paymentCode}`}
              aria-busy={isBusy}
            >
              <div className="review-applicant">
                <span>{paymentCode}</span>
                <strong style={wrapAnywhereStyle}>คำขอจอง {payment.bookingId}</strong>
                <small>ผู้ดูแลกำลังตรวจหลักฐาน</small>
                <ul className="certificate-list" aria-label={`ข้อมูลประกอบสลิป ${paymentCode}`}>
                  {evidence.map(([label, value]) => (
                    <li key={label}>
                      <div>
                        <span>
                          <small>{label}</small>
                          <strong style={wrapAnywhereStyle}>{value}</strong>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <label className="review-note">
                  <span>ผลตรวจสลิป {paymentCode}</span>
                  <textarea
                    value={paymentNotes[payment.id] ?? ""}
                    onChange={(event) => setPaymentNotes((current) => ({ ...current, [payment.id]: event.target.value }))}
                    disabled={isBusy || isResolved}
                    rows={3}
                    placeholder="ระบุเหตุผลเมื่อสลิปไม่ผ่าน"
                  />
                </label>
                {isResolved && <p className="queue-notice" role="status">บันทึกผลแล้ว รอคิวอัปเดต</p>}
                {rowErrors[rowKey] && <p className="row-error" role="alert">{rowErrors[rowKey]}</p>}
              </div>
              <StatusBadge status="reviewing" />
              <div className="queue-actions">
                <button
                  type="button"
                  aria-label={`เปิดสลิป ${paymentCode}`}
                  disabled={isBusy || isResolved}
                  onClick={() => void openFile(payment.fileUrl, rowKey)}
                >
                  {busyAction === "file" ? "กำลังเปิด…" : "เปิดสลิป"}
                </button>
                <button
                  type="button"
                  aria-label={`อนุมัติสลิป ${paymentCode}`}
                  disabled={isBusy || isResolved}
                  onClick={() => void decidePayment(payment.id, "approve")}
                >
                  {busyAction === "approve" ? "กำลังบันทึก…" : "อนุมัติ"}
                </button>
                <button
                  type="button"
                  aria-label={`ไม่อนุมัติสลิป ${paymentCode}`}
                  disabled={isBusy || isResolved}
                  onClick={() => void decidePayment(payment.id, "reject")}
                >
                  {busyAction === "reject" ? "กำลังบันทึก…" : "ไม่อนุมัติ"}
                </button>
                {isResolved && (
                  <button
                    type="button"
                    aria-label={`ลองโหลดคิว ${paymentCode} อีกครั้ง`}
                    disabled={isBusy}
                    onClick={() => void retryPaymentRefresh(payment.id)}
                  >
                    {busyAction === "refresh" ? "กำลังโหลด…" : "ลองโหลดคิวอีกครั้ง"}
                  </button>
                )}
              </div>
            </article>
          );
        })}

          {currentQueue.payments.length === 0 && (
            <div className="empty-state"><strong>ไม่มีหลักฐานการชำระเงินรอตรวจ</strong></div>
          )}
          </div>
        </details>

        {currentQueue.trainers.length + currentQueue.payments.length === 0 && (
          <div className="empty-state"><strong>ไม่มีรายการรอตรวจ</strong><p>คิวตรวจสอบเป็นปัจจุบันแล้ว</p></div>
        )}
      </section>
    </div>
  );
}
