"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest, openProtectedFile } from "@/lib/api";
import { getAdminNextAction } from "@/lib/dashboard-actions";
import { formatDateTime } from "@/lib/format";
import { leaveExpiredSession } from "@/lib/session";
import type { AdminQueue } from "@/lib/types";

/** Trainer applications waiting for an administrator. Payments settle through Stripe and need no review. */
export function AdminReviewQueue({ onQueueLoaded }: {
  onQueueLoaded?: (queue: AdminQueue) => void;
}) {
  const router = useRouter();
  const navigate = router.push;
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyRows, setBusyRows] = useState<Record<string, "file" | "approve" | "reject">>({});
  const [selectedReviewKey, setSelectedReviewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const queueRequestRef = useRef(0);
  // Held in a ref so a new callback identity never re-creates `loadQueue`.
  const onQueueLoadedRef = useRef(onQueueLoaded);
  useEffect(() => {
    onQueueLoadedRef.current = onQueueLoaded;
  }, [onQueueLoaded]);

  function startRowTask(rowKey: string, action: "file" | "approve" | "reject") {
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
      // Keep whatever asked for the count (the workspace's next-action card)
      // showing the same queue this list just loaded.
      onQueueLoadedRef.current?.(nextQueue);
      const availableKeys = [
        ...nextQueue.trainers.map((trainer) => `trainer-${trainer.id}`),
      ];
      setSelectedReviewKey((current) => current && availableKeys.includes(current) ? current : (availableKeys[0] ?? null));
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
    const trainer = queue?.trainers.find((entry) => entry.id === trainerId);
    const trainerName = trainer?.displayName ?? `TR-${String(trainerId).padStart(6, "0")}`;
    const subject = trainer?.kind === "edit" ? "การแก้ไขโปรไฟล์ของ" : "ใบสมัคร";
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
        setNotice(`${decision === "approve" ? "อนุมัติ" : "ปฏิเสธ"}${subject}${trainerName}แล้ว`);
      } else if (refreshResult === "failed") {
        setRowErrors((current) => ({ ...current, [rowKey]: "บันทึกผลแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้" }));
        setNotice(`บันทึกผล${subject}${trainerName}แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้`);
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

  const currentQueue = queue ?? { trainers: [] };
  const reviewItems = [
    ...currentQueue.trainers.map((trainer) => ({
      key: `trainer-${trainer.id}`,
      id: trainer.id,
      type: "trainer" as const,
      code: `TR-${String(trainer.id).padStart(6, "0")}`,
      title: trainer.displayName,
      detail: `${trainer.certificates.length} เอกสาร`,
      label: trainer.kind === "edit" ? "แก้ไขโปรไฟล์" : "ใบสมัครเทรนเนอร์",
      submittedAt: trainer.submittedAt,
    })),
  ];
  const activeReviewKey = selectedReviewKey && reviewItems.some((item) => item.key === selectedReviewKey)
    ? selectedReviewKey
    : (reviewItems[0]?.key ?? null);
  const selectedTrainer = activeReviewKey?.startsWith("trainer-")
    ? currentQueue.trainers.find((trainer) => `trainer-${trainer.id}` === activeReviewKey) ?? null
    : null;
  const selectedRowBusy = activeReviewKey ? busyRows[activeReviewKey] : undefined;

  return (
    <div className="admin-board">
      <NextActionCard action={getAdminNextAction(currentQueue)} />

      <section className="admin-summary" aria-label="สรุปคิวตรวจสอบ">
        <div><span>ใบสมัครรอตรวจ</span><strong>{String(currentQueue.trainers.length).padStart(2, "0")}</strong></div>
      </section>

      <section id="review-queue" className="admin-review-workbench" aria-labelledby="review-queue-title">
        <header className="admin-review-workbench__heading">
          <div>
            <h2 id="review-queue-title">ตรวจสอบและอนุมัติข้อมูลเทรนเนอร์</h2>
            <p>เลือกใบสมัครหรือการแก้ไขโปรไฟล์ ตรวจเอกสารรับรอง แล้วบันทึกคำตัดสิน</p>
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
                      aria-label={`เลือกตรวจ${item.label === "แก้ไขโปรไฟล์" ? "การแก้ไขโปรไฟล์" : "ใบสมัคร"} ${item.title}`}
                      aria-current={activeReviewKey === item.key ? "true" : undefined}
                      disabled={Boolean(busyRows[item.key])}
                      onClick={() => setSelectedReviewKey(item.key)}
                    >
                      <span><strong>{item.code}</strong><small>{item.label}</small></span>
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
                      <div><dt>{selectedTrainer.kind === "edit" ? "ส่งการแก้ไขเมื่อ" : "ส่งใบสมัครเมื่อ"}</dt><dd>{formatDateTime(selectedTrainer.submittedAt)}</dd></div>
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

          </div>
        ) : (
          <div className="empty-state">
            <strong>ไม่มีรายการรอตรวจ</strong>
            <p>คิวตรวจสอบเป็นปัจจุบันแล้ว หากเทรนเนอร์เพิ่งส่งใบสมัคร ให้โหลดคิวอีกครั้ง</p>
            <button className="button" type="button" disabled={loading} onClick={() => void loadQueue()}>
              <RefreshCw aria-hidden="true" size={16} /> {loading ? "กำลังโหลด…" : "โหลดคิวอีกครั้ง"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
