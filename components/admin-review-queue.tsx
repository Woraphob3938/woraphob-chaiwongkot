"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, FileText, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest, openProtectedFile } from "@/lib/api";
import { getAdminNextAction } from "@/lib/dashboard-actions";
import { formatDateTime, formatTime } from "@/lib/format";
import { leaveExpiredSession } from "@/lib/session";
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

type PaymentDecisionResponse = {
  bookingStatus: "awaiting_payment" | "confirmed" | "expired";
  paymentDeadlineAt: string | null;
};

/**
 * The freelance trainer's own slip queue, kept behind a disclosure at the end of
 * the workspace. The count comes from the workspace that already fetched the
 * queue, so the next-action card and this summary cannot disagree.
 */
export function TrainerPaymentReview({ pendingSlips, open = false, onQueueLoaded }: {
  pendingSlips: number | null;
  open?: boolean;
  onQueueLoaded?: (queue: AdminQueue) => void;
}) {
  const [openState, setOpenState] = useState(open);
  return <details
    id="payment-review"
    className="admin-record-disclosure"
    // Re-keying on the action target resets `openState` to the new prop without
    // an effect, the same way the availability disclosure is opened by the
    // next-action card.
    key={open ? "payment-review-action" : "payment-review-idle"}
    open={openState}
    onToggle={(event) => setOpenState(event.currentTarget.open)}
  >
    <summary>
      <span><ShieldCheck aria-hidden="true" size={20} /><strong>ตรวจสลิปการจองของฉัน</strong></span>
      <small>{pendingSlips === null ? "ยังโหลดจำนวนไม่ได้" : `${pendingSlips} สลิป`}</small>
    </summary>
    {openState && <AdminReviewQueue reviewer="trainer" onQueueLoaded={onQueueLoaded} />}
  </details>;
}

export function AdminReviewQueue({ reviewer = "admin", onQueueLoaded }: {
  reviewer?: "admin" | "trainer";
  onQueueLoaded?: (queue: AdminQueue) => void;
}) {
  const router = useRouter();
  const navigate = router.push;
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [paymentNotes, setPaymentNotes] = useState<Record<number, string>>({});
  const [bankConfirmations, setBankConfirmations] = useState<Record<number, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [resolvedPayments, setResolvedPayments] = useState<Record<number, true>>({});
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyRows, setBusyRows] = useState<Record<string, "file" | "approve" | "reject" | "refresh">>({});
  const [selectedReviewKey, setSelectedReviewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const queueRequestRef = useRef(0);
  // Held in a ref so a new callback identity never re-creates `loadQueue`.
  const onQueueLoadedRef = useRef(onQueueLoaded);
  useEffect(() => {
    onQueueLoadedRef.current = onQueueLoaded;
  }, [onQueueLoaded]);

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
      const nextQueue = await authenticatedRequest<AdminQueue>(`/v1/${reviewer}/review-queue`);
      if (requestId !== queueRequestRef.current) return "superseded" as const;
      setQueue(nextQueue);
      // Keep whatever asked for the count (the workspace's next-action card)
      // showing the same queue this list just loaded.
      onQueueLoadedRef.current?.(nextQueue);
      const availableKeys = [
        ...nextQueue.trainers.map((trainer) => `trainer-${trainer.id}`),
        ...nextQueue.payments.map((payment) => `payment-${payment.id}`),
      ];
      setSelectedReviewKey((current) => current && availableKeys.includes(current) ? current : (availableKeys[0] ?? null));
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
  }, [navigate, reviewer]);

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
          setNotice("ผู้ดูแลระบบคนอื่นบันทึกผลรายการนี้แล้ว โหลดคิวล่าสุดแล้ว");
        } else if (refreshResult === "failed") {
          setRowErrors((current) => ({ ...current, [rowKey]: "รายการนี้มีผลตรวจแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้" }));
          setNotice("ผู้ดูแลระบบคนอื่นบันทึกผลรายการนี้แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้");
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
    if (decision === "approve" && !bankConfirmations[paymentId]) {
      setRowErrors((current) => ({ ...current, [rowKey]: "ตรวจรายการเงินจริงในแอปธนาคารและทำเครื่องหมายยืนยันก่อนอนุมัติ" }));
      return;
    }
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
        body: JSON.stringify(decision === "approve" ? { bankConfirmed: true } : { note }),
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
          setNotice("ผู้ดูแลระบบคนอื่นบันทึกผลรายการนี้แล้ว โหลดคิวล่าสุดแล้ว");
        } else if (refreshResult === "failed") {
          setRowErrors((current) => ({ ...current, [rowKey]: "รายการนี้มีผลตรวจแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้" }));
          setNotice("ผู้ดูแลระบบคนอื่นบันทึกผลรายการนี้แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้");
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
  const reviewItems = [
    ...currentQueue.trainers.map((trainer) => ({
      key: `trainer-${trainer.id}`,
      id: trainer.id,
      type: "trainer" as const,
      code: `TR-${String(trainer.id).padStart(6, "0")}`,
      title: trainer.displayName,
      detail: `${trainer.certificates.length} เอกสาร`,
      submittedAt: trainer.submittedAt,
    })),
    ...currentQueue.payments.map((payment) => ({
      key: `payment-${payment.id}`,
      id: payment.id,
      type: "payment" as const,
      code: `PAY-${String(payment.id).padStart(6, "0")}`,
      title: `คำขอจอง ${payment.bookingId}`,
      detail: payment.memberName,
      submittedAt: payment.submittedAt,
    })),
  ];
  const activeReviewKey = selectedReviewKey && reviewItems.some((item) => item.key === selectedReviewKey)
    ? selectedReviewKey
    : (reviewItems[0]?.key ?? null);
  const selectedTrainer = activeReviewKey?.startsWith("trainer-")
    ? currentQueue.trainers.find((trainer) => `trainer-${trainer.id}` === activeReviewKey) ?? null
    : null;
  const selectedPayment = activeReviewKey?.startsWith("payment-")
    ? currentQueue.payments.find((payment) => `payment-${payment.id}` === activeReviewKey) ?? null
    : null;
  const selectedRowBusy = activeReviewKey ? busyRows[activeReviewKey] : undefined;

  return (
    <div className="admin-board">
      {reviewer === "admin" && <NextActionCard action={getAdminNextAction(currentQueue)} />}

      <section className="admin-summary" aria-label="สรุปคิวตรวจสอบ">
        <div><span>ใบสมัครรอตรวจ</span><strong>{String(currentQueue.trainers.length).padStart(2, "0")}</strong></div>
        <div><span>{reviewer === "admin" ? "สลิปรอเทรนเนอร์ตรวจ" : "สลิปรอตรวจ"}</span><strong>{String(currentQueue.payments.length).padStart(2, "0")}</strong></div>
      </section>

      <section id="review-queue" className="admin-review-workbench" aria-labelledby="review-queue-title">
        <header className="admin-review-workbench__heading">
          <div>
            <h2 id="review-queue-title">{reviewer === "admin" ? "ตรวจสอบและอนุมัติข้อมูลเทรนเนอร์" : "โต๊ะตรวจสอบ"}</h2>
            <p>{reviewer === "admin" ? "ตรวจใบสมัครเทรนเนอร์และติดตามสลิปที่รอเทรนเนอร์ยืนยัน" : "เลือกหนึ่งรายการ ตรวจหลักฐาน แล้วบันทึกคำตัดสิน"}</p>
          </div>
          <span>{loading ? "กำลังอัปเดต" : "ข้อมูลจากระบบ"}</span>
        </header>
        {notice && <p ref={noticeRef} className="queue-notice" role="status" tabIndex={-1}>{notice}</p>}

        {reviewItems.length > 0 ? (
          <div className="admin-workbench-grid">
            <nav className="admin-workbench-queue" aria-label="คิวรายการรอตรวจ">
              <header><h3>คิวรายการรอตรวจ</h3><span>{reviewItems.length}</span></header>
              <ol>
                {reviewItems.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      aria-label={item.type === "trainer" ? `เลือกตรวจใบสมัคร ${item.title}` : `เลือกตรวจสลิป ${item.code}`}
                      aria-current={activeReviewKey === item.key ? "true" : undefined}
                      disabled={Boolean(busyRows[item.key]) || (item.type === "payment" && Boolean(resolvedPayments[item.id]))}
                      onClick={() => setSelectedReviewKey(item.key)}
                    >
                      <span><strong>{item.code}</strong><small>{item.type === "trainer" ? "ใบสมัครเทรนเนอร์" : "หลักฐานการชำระเงิน"}</small></span>
                      <span><strong>{item.title}</strong><small>{item.detail} · {formatDateTime(item.submittedAt)}</small></span>
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            {selectedTrainer && (() => {
              const rowKey = `trainer-${selectedTrainer.id}`;
              const isBusy = Boolean(busyRows[rowKey]);
              return (
                <>
                  <section className="admin-evidence-panel" aria-label={`หลักฐานของ${selectedTrainer.displayName}`} aria-busy={isBusy}>
                    <header>
                      <div><span>TR-{String(selectedTrainer.id).padStart(6, "0")}</span><h3>{selectedTrainer.displayName}</h3></div>
                      <StatusBadge status="pending" />
                    </header>
                    <dl className="admin-evidence-facts">
                      <div><dt>ส่งใบสมัครเมื่อ</dt><dd>{formatDateTime(selectedTrainer.submittedAt)}</dd></div>
                      <div><dt>เอกสารรับรอง</dt><dd>{selectedTrainer.certificates.length} รายการ</dd></div>
                    </dl>
                    <ul className="certificate-list" aria-label={`เอกสารของ${selectedTrainer.displayName}`}>
                      {selectedTrainer.certificates.map((certificate) => (
                        <li key={certificate.id}>
                          <div>
                            <FileText aria-hidden="true" size={17} />
                            <span><strong>{certificate.name}</strong><small>{certificate.issuer} · {formatDateTime(certificate.submittedAt)}</small></span>
                          </div>
                          <button className="certificate-action" type="button" disabled={isBusy} onClick={() => void openFile(certificate.fileUrl, rowKey)}>
                            {busyRows[rowKey] === "file" ? "กำลังเปิด…" : "เปิด PDF"}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {selectedTrainer.certificates.length === 0 && <div className="empty-state"><strong>ไม่มีเอกสารรับรอง</strong></div>}
                  </section>
                  <aside className="admin-decision-panel" aria-label={`คำตัดสินสำหรับ${selectedTrainer.displayName}`} aria-busy={isBusy}>
                    <header><h3>คำตัดสิน</h3><StatusBadge status="pending" /></header>
                    <label className="review-note">
                      <span>หมายเหตุสำหรับ{selectedTrainer.displayName}</span>
                      <textarea
                        value={notes[selectedTrainer.id] ?? ""}
                        onChange={(event) => setNotes((current) => ({ ...current, [selectedTrainer.id]: event.target.value }))}
                        disabled={isBusy}
                        rows={5}
                        placeholder="ใช้แจ้งเหตุผลเมื่อปฏิเสธ หรือบันทึกประกอบการอนุมัติ"
                      />
                    </label>
                    {rowErrors[rowKey] && <p className="row-error" role="alert">{rowErrors[rowKey]}</p>}
                    <div className="queue-actions">
                      <button type="button" disabled={isBusy} onClick={() => void decideTrainer(selectedTrainer.id, "approve")}>{selectedRowBusy === "approve" ? "กำลังบันทึก…" : "อนุมัติ"}</button>
                      <button type="button" disabled={isBusy} onClick={() => void decideTrainer(selectedTrainer.id, "reject")}>{selectedRowBusy === "reject" ? "กำลังบันทึก…" : "ปฏิเสธ"}</button>
                    </div>
                  </aside>
                </>
              );
            })()}

            {selectedPayment && (() => {
              const rowKey = `payment-${selectedPayment.id}`;
              const paymentCode = `PAY-${String(selectedPayment.id).padStart(6, "0")}`;
              const busyAction = busyRows[rowKey];
              const isBusy = Boolean(busyAction);
              const isResolved = Boolean(resolvedPayments[selectedPayment.id]);
              const evidence = [
                ["สมาชิก", selectedPayment.memberName],
                ["เทรนเนอร์", selectedPayment.trainerName],
                ["วันและเวลานัด", `${formatDateTime(selectedPayment.startsAt)} ถึง ${formatDateTime(selectedPayment.endsAt)}`],
                [selectedPayment.bookingType === "monthly" ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง", formatPaymentAmount(selectedPayment.quotedPrice)],
                ["ส่งหลักฐานเมื่อ", formatDateTime(selectedPayment.submittedAt)],
                ["สถานะ", "รอตรวจสลิป"],
              ];
              // Three things the trainer compares in their banking app. None of
              // them replaces finding the credit there; they narrow what to look for.
              const windowEnds = selectedPayment.windowEndsAt ? new Date(selectedPayment.windowEndsAt) : null;
              const windowStarts = windowEnds ? new Date(windowEnds.getTime() - 10 * 60 * 1000) : null;
              const slipChecks = [
                {
                  label: "QR ในสลิป",
                  value: selectedPayment.slipReference
                    ? `อ่านได้และไม่ซ้ำกับสลิปอื่น · อ้างอิง ${selectedPayment.slipReference.split(":").pop()}`
                    : "อ่านไม่ได้ ตรวจยอดและเวลาในแอปธนาคารอย่างละเอียด",
                  ok: Boolean(selectedPayment.slipReference),
                },
                {
                  label: "ยอดที่ต้องพบในบัญชี",
                  value: selectedPayment.amount === null
                    ? formatPaymentAmount(null)
                    : `${formatPaymentAmount(selectedPayment.amount)} ตรงถึงสตางค์`,
                  ok: selectedPayment.amount !== null,
                },
                {
                  label: "เวลาโอนในสลิปต้องอยู่ระหว่าง",
                  value: windowStarts && windowEnds
                    ? `${formatDateTime(windowStarts.toISOString())} – ${formatTime(windowEnds.toISOString())} น.`
                    : "ไม่มีข้อมูลช่วงเวลาของสลิปนี้",
                  ok: Boolean(windowEnds),
                },
              ];
              return (
                <>
                  <section className="admin-evidence-panel" aria-label={`หลักฐานของสลิป ${paymentCode}`} aria-busy={isBusy}>
                    <article aria-label={`ตรวจสลิป ${paymentCode}`}>
                      <header>
                        <div><span>{paymentCode}</span><h3 style={wrapAnywhereStyle}>คำขอจอง {selectedPayment.bookingId}</h3></div>
                        <StatusBadge status="reviewing" />
                      </header>
                      <p>{reviewer === "trainer" ? "ตรวจหลักฐานการชำระเงินของคุณ" : "ตรวจหลักฐานของยิมที่คุณดูแล"}</p>
                      <dl className="admin-evidence-facts admin-evidence-facts--payment">
                        {evidence.map(([label, value]) => (
                          <div key={label}><dt>{label}</dt><dd style={wrapAnywhereStyle}>{value}</dd></div>
                        ))}
                      </dl>
                      <section className="slip-checks" aria-label={`สิ่งที่ต้องตรวจในแอปธนาคารสำหรับ ${paymentCode}`}>
                        <h4><QrCode aria-hidden="true" size={16} /> ตรวจกับแอปธนาคาร</h4>
                        <ul>
                          {slipChecks.map((check) => (
                            <li key={check.label} className={check.ok ? undefined : "is-warning"}>
                              {check.ok ? <ShieldCheck aria-hidden="true" size={16} /> : <CircleAlert aria-hidden="true" size={16} />}
                              <span><small>{check.label}</small><strong style={wrapAnywhereStyle}>{check.value}</strong></span>
                            </li>
                          ))}
                        </ul>
                      </section>
                      <button className="certificate-action admin-slip-action" type="button" aria-label={`เปิดสลิป ${paymentCode}`} disabled={isBusy || isResolved} onClick={() => void openFile(selectedPayment.fileUrl, rowKey)}>
                        {busyAction === "file" ? "กำลังเปิด…" : "เปิดสลิป"}
                      </button>
                    </article>
                  </section>
                  {reviewer === "admin" ? (
                    // บทที่ 1: the booked trainer confirms every slip; the
                    // administrator follows the queue without deciding it.
                    <aside className="admin-decision-panel admin-decision-panel--readonly" aria-label={`สถานะสลิป ${paymentCode}`}>
                      <header><h3>ผู้ยืนยันสลิป</h3><StatusBadge status="reviewing" /></header>
                      <p>เทรนเนอร์ของการจองนี้เป็นผู้ตรวจและยืนยันสลิป ผู้ดูแลระบบเปิดดูหลักฐานเพื่อติดตามได้อย่างเดียว</p>
                    </aside>
                  ) : (
                  <aside className="admin-decision-panel" aria-label={`คำตัดสินสำหรับสลิป ${paymentCode}`} aria-busy={isBusy}>
                      <header><h3>คำตัดสิน</h3><StatusBadge status="reviewing" /></header>
                      <label className="review-note">
                        <span>ผลตรวจสลิป {paymentCode}</span>
                        <textarea
                          value={paymentNotes[selectedPayment.id] ?? ""}
                          onChange={(event) => setPaymentNotes((current) => ({ ...current, [selectedPayment.id]: event.target.value }))}
                          disabled={isBusy || isResolved}
                          rows={5}
                          placeholder="ระบุเหตุผลเมื่อสลิปไม่ผ่าน"
                        />
                      </label>
                      <label className="admin-bank-confirmation">
                        <input
                          type="checkbox"
                          checked={Boolean(bankConfirmations[selectedPayment.id])}
                          disabled={isBusy || isResolved}
                          onChange={(event) => {
                            setBankConfirmations((current) => ({ ...current, [selectedPayment.id]: event.target.checked }));
                            setRowErrors((current) => ({ ...current, [rowKey]: "" }));
                          }}
                        />
                        <span><strong>พบเงินเข้าในแอปธนาคารแล้ว</strong><small>ตรวจผู้รับ ยอดเงิน วันเวลา และเลขอ้างอิงให้ตรงกับสลิป</small></span>
                      </label>
                      {isResolved && <p className="queue-notice" role="status">บันทึกผลแล้ว รอคิวอัปเดต</p>}
                      {rowErrors[rowKey] && <p className="row-error" role="alert">{rowErrors[rowKey]}</p>}
                      <div className="queue-actions">
                        <button type="button" aria-label={`อนุมัติสลิป ${paymentCode}`} disabled={isBusy || isResolved || !bankConfirmations[selectedPayment.id]} onClick={() => void decidePayment(selectedPayment.id, "approve")}>{busyAction === "approve" ? "กำลังบันทึก…" : "อนุมัติ"}</button>
                        <button type="button" aria-label={`ไม่อนุมัติสลิป ${paymentCode}`} disabled={isBusy || isResolved} onClick={() => void decidePayment(selectedPayment.id, "reject")}>{busyAction === "reject" ? "กำลังบันทึก…" : "ไม่อนุมัติ"}</button>
                        {isResolved && (
                          <button type="button" aria-label={`ลองโหลดคิว ${paymentCode} อีกครั้ง`} disabled={isBusy} onClick={() => void retryPaymentRefresh(selectedPayment.id)}>
                            {busyAction === "refresh" ? "กำลังโหลด…" : "ลองโหลดคิวอีกครั้ง"}
                          </button>
                        )}
                      </div>
                    </aside>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          <div className="empty-state">
            <strong>ไม่มีรายการรอตรวจ</strong>
            <p>คิวตรวจสอบเป็นปัจจุบันแล้ว หากสมาชิกเพิ่งส่งสลิป ให้โหลดคิวอีกครั้ง</p>
            <button className="button" type="button" disabled={loading} onClick={() => void loadQueue()}>
              <RefreshCw aria-hidden="true" size={16} /> {loading ? "กำลังโหลด…" : "โหลดคิวอีกครั้ง"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
