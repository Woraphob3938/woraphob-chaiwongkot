"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest, openProtectedFile } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AdminQueue } from "@/lib/types";

function leaveExpiredSession(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  localStorage.removeItem("fitconnect_token");
  window.location.assign("/login");
  return true;
}

export function AdminReviewQueue() {
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadQueue = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      setQueue(await authenticatedRequest<AdminQueue>("/v1/admin/review-queue"));
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setLoadError(error instanceof Error ? error.message : "โหลดคิวตรวจสอบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function openFile(path: string, rowKey: string) {
    setRowErrors((current) => ({ ...current, [rowKey]: "" }));
    try {
      await openProtectedFile(path);
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setRowErrors((current) => ({
        ...current,
        [rowKey]: error instanceof Error ? error.message : "เปิดไฟล์ไม่สำเร็จ",
      }));
    }
  }

  async function decideTrainer(trainerId: number, decision: "approve" | "reject") {
    const rowKey = `trainer-${trainerId}`;
    const note = notes[trainerId]?.trim() ?? "";
    if (decision === "reject" && !note) {
      setRowErrors((current) => ({ ...current, [rowKey]: "กรุณาระบุเหตุผลก่อนปฏิเสธ" }));
      return;
    }

    setBusy(rowKey);
    setNotice("");
    setRowErrors((current) => ({ ...current, [rowKey]: "" }));
    try {
      await authenticatedRequest(`/v1/admin/trainers/${trainerId}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      await loadQueue();
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      const message = error instanceof Error ? error.message : "บันทึกผลไม่สำเร็จ";
      setRowErrors((current) => ({ ...current, [rowKey]: message }));
      if (error instanceof ApiError && error.status === 409) {
        setNotice("รายการนี้ถูกผู้ดูแลคนอื่นตัดสินใจแล้ว คิวได้รับการอัปเดตล่าสุด");
        await loadQueue();
      }
    } finally {
      setBusy(null);
    }
  }

  async function decidePayment(paymentId: number, decision: "approve" | "reject") {
    const rowKey = `payment-${paymentId}`;
    setBusy(rowKey);
    setNotice("");
    setRowErrors((current) => ({ ...current, [rowKey]: "" }));
    try {
      await authenticatedRequest(`/v1/admin/payments/${paymentId}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ note: decision === "approve" ? "ยอดและคำขอตรงกัน" : "หลักฐานไม่ตรงกับคำขอ" }),
      });
      await loadQueue();
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      const message = error instanceof Error ? error.message : "บันทึกผลไม่สำเร็จ";
      setRowErrors((current) => ({ ...current, [rowKey]: message }));
      if (error instanceof ApiError && error.status === 409) {
        setNotice("รายการนี้ถูกผู้ดูแลคนอื่นตัดสินใจแล้ว คิวได้รับการอัปเดตล่าสุด");
        await loadQueue();
      }
    } finally {
      setBusy(null);
    }
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
      <section className="admin-summary" aria-label="สรุปคิวตรวจสอบ">
        <div><span>ใบสมัครรอตรวจ</span><strong>{String(currentQueue.trainers.length).padStart(2, "0")}</strong></div>
        <div><span>สลิปรอตรวจ</span><strong>{String(currentQueue.payments.length).padStart(2, "0")}</strong></div>
        <div><span>รายงานที่ต้องติดตาม</span><strong>00</strong></div>
      </section>

      <section className="verification-queue" aria-labelledby="review-queue-title">
        <div className="section-line-heading">
          <div><p className="label">ลำดับการตรวจ</p><h2 id="review-queue-title">รายการที่ต้องตัดสินใจ</h2></div>
          <span>{loading ? "กำลังอัปเดต" : "ข้อมูลจากระบบ"}</span>
        </div>
        {notice && <p className="queue-notice" role="status">{notice}</p>}

        {currentQueue.trainers.map((trainer) => {
          const rowKey = `trainer-${trainer.id}`;
          const isBusy = busy === rowKey;
          return (
            <article className="verification-row verification-row--trainer" key={rowKey} aria-busy={isBusy}>
              <div className="review-applicant">
                <span>TR-{String(trainer.id).padStart(6, "0")}</span>
                <strong>{trainer.displayName}</strong>
                <small>จังหวัด{trainer.province} · ส่งเมื่อ {formatDateTime(trainer.submittedAt)}</small>
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

        {currentQueue.payments.map((payment) => {
          const rowKey = `payment-${payment.id}`;
          const isBusy = busy === rowKey;
          return (
            <article className="verification-row" key={rowKey} aria-busy={isBusy}>
              <div>
                <span>PAY-{String(payment.id).padStart(6, "0")}</span>
                <strong>สลิปคำขอ {payment.bookingId}</strong>
                <small>{payment.memberName} · รอตรวจยอดกับคำขอ</small>
                {rowErrors[rowKey] && <p className="row-error" role="alert">{rowErrors[rowKey]}</p>}
              </div>
              <StatusBadge status="reviewing" />
              <div className="queue-actions">
                <button type="button" disabled={isBusy} onClick={() => void openFile(payment.fileUrl, rowKey)}>เปิดสลิป</button>
                <button type="button" disabled={isBusy} onClick={() => void decidePayment(payment.id, "approve")}>{isBusy ? "กำลังบันทึก…" : "อนุมัติ"}</button>
                <button type="button" disabled={isBusy} onClick={() => void decidePayment(payment.id, "reject")}>ไม่ผ่าน</button>
              </div>
            </article>
          );
        })}

        {currentQueue.trainers.length + currentQueue.payments.length === 0 && (
          <div className="empty-state"><strong>ไม่มีรายการรอตรวจ</strong><p>คิวตรวจสอบเป็นปัจจุบันแล้ว</p></div>
        )}
      </section>
    </div>
  );
}
