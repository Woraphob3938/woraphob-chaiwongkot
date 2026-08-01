"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: live chat workbench · genre: utilitarian athletic · theme: FitConnect workbench
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: uses locked FitConnect tokens
 */

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, MessageSquareText, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { authenticatedRequest, openProtectedFile } from "@/lib/api";
import { formatDateTime, initials } from "@/lib/format";
import type { Booking, ChatMessage } from "@/lib/types";

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const ACCEPTED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const bookingStatusCopy: Record<Booking["status"], string> = {
  pending_trainer: "รอเทรนเนอร์ตอบรับ",
  awaiting_payment: "รอส่งหลักฐานการชำระ",
  payment_review: "รอผู้ดูแลตรวจหลักฐาน",
  confirmed: "ยืนยันนัดแล้ว",
  completed: "ฝึกเสร็จแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

const paymentStatusCopy: Record<Booking["paymentStatus"], string> = {
  not_submitted: "ยังไม่ส่งหลักฐาน",
  reviewing: "รอผู้ดูแลตรวจสลิป",
  approved: "ผู้ดูแลตรวจสลิปแล้ว",
  rejected: "ผู้ดูแลขอหลักฐานใหม่",
};

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((left, right) => left.id - right.id);
}

function readableSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(bytes % (1_024 * 1_024) === 0 ? 0 : 1)} MB`;
}

function readableMime(mime: string): string {
  const known: Record<string, string> = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WebP",
    "application/pdf": "PDF",
  };
  return known[mime] ?? mime;
}

function formatAmount(amount: number | null): string {
  if (amount === null) return "ไม่มียอดที่บันทึก";
  return `${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} บาท`;
}

type ChatWorkbenchProps = {
  initialBookingId?: string;
};

export function ChatWorkbench({ initialBookingId }: ChatWorkbenchProps) {
  const [rooms, setRooms] = useState<Booking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [roomsError, setRoomsError] = useState("");
  const [threadError, setThreadError] = useState("");
  const [composerError, setComposerError] = useState("");
  const [attachmentError, setAttachmentError] = useState("");
  const [notice, setNotice] = useState("");
  const [messageText, setMessageText] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [openingAttachment, setOpeningAttachment] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const cursorRef = useRef(0);
  const retryCursorRef = useRef<number | null>(null);
  const sendLockRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedBooking = useMemo(
    () => rooms.find((booking) => booking.id === selectedBookingId) ?? null,
    [rooms, selectedBookingId],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError("");
    try {
      const bookings = await authenticatedRequest<Booking[]>("/v1/bookings");
      if (!mountedRef.current) return;
      const readableRooms = bookings.filter(
        (booking): booking is Booking & { chatRoomId: number } => booking.chatRoomId !== null && booking.actions.canReadChat,
      );
      setRooms(readableRooms);
      setSelectedBookingId((current) => {
        if (current && readableRooms.some((booking) => booking.id === current)) return current;
        if (initialBookingId && readableRooms.some((booking) => booking.id === initialBookingId)) return initialBookingId;
        return readableRooms[0]?.id ?? "";
      });
    } catch (error) {
      if (mountedRef.current) {
        setRoomsError(error instanceof Error ? error.message : "โหลดห้องสนทนาไม่สำเร็จ");
      }
    } finally {
      if (mountedRef.current) setRoomsLoading(false);
    }
  }, [initialBookingId]);

  useEffect(() => {
    queueMicrotask(() => {
      if (mountedRef.current) void loadRooms();
    });
  }, [loadRooms]);

  const loadMessages = useCallback(async (
    roomId: number,
    afterId: number,
    generation: number,
    failureMessage = "โหลดข้อความไม่สำเร็จ กรุณาลองใหม่",
  ): Promise<boolean> => {
    try {
      const incoming = await authenticatedRequest<ChatMessage[]>(
        `/v1/chat-rooms/${roomId}/messages?afterId=${afterId}`,
      );
      if (!mountedRef.current || generationRef.current !== generation) return false;
      setMessages((current) => mergeMessages(current, incoming));
      if (incoming.length > 0) {
        cursorRef.current = Math.max(cursorRef.current, ...incoming.map((message) => message.id));
      }
      setThreadError("");
      return true;
    } catch {
      if (!mountedRef.current || generationRef.current !== generation) return false;
      setThreadError(failureMessage);
      return false;
    } finally {
      if (mountedRef.current && generationRef.current === generation) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedBooking?.chatRoomId === null || selectedBooking?.chatRoomId === undefined) {
      return;
    }

    const roomId = selectedBooking.chatRoomId;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    cursorRef.current = 0;
    retryCursorRef.current = null;
    sendLockRef.current = false;
    queueMicrotask(() => {
      if (!mountedRef.current || generationRef.current !== generation) return;
      setMessages([]);
      setThreadError("");
      setComposerError("");
      setAttachmentError("");
      setNotice("");
      setMessageText("");
      setAttachment(null);
      setThreadLoading(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void loadMessages(roomId, 0, generation);
    });

    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void loadMessages(roomId, cursorRef.current, generation);
    };
    const timer = window.setInterval(poll, 5_000);
    document.addEventListener("visibilitychange", poll);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [loadMessages, selectedBooking]);

  function selectAttachment(file: File | null) {
    setNotice("");
    setComposerError("");
    if (!file) {
      setAttachment(null);
      return;
    }
    if (!ACCEPTED_ATTACHMENT_TYPES.has(file.type)) {
      setAttachment(null);
      setComposerError("รองรับเฉพาะ JPEG, PNG, WebP หรือ PDF");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setAttachment(null);
      setComposerError("ไฟล์ต้องมีขนาดไม่เกิน 5 MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setAttachment(file);
  }

  function removeAttachment() {
    setAttachment(null);
    setComposerError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendLockRef.current || !selectedBooking?.chatRoomId || !selectedBooking.actions.canSendChat) return;

    const trimmedMessage = messageText.trim();
    if (!trimmedMessage && !attachment) {
      setComposerError("กรุณาพิมพ์ข้อความหรือแนบไฟล์");
      return;
    }

    const roomId = selectedBooking.chatRoomId;
    const generation = generationRef.current;
    const previousCursor = cursorRef.current;
    const body = new FormData();
    if (trimmedMessage) body.set("message", trimmedMessage);
    if (attachment) body.set("attachment", attachment);

    sendLockRef.current = true;
    setSending(true);
    setComposerError("");
    setThreadError("");
    setNotice("");

    try {
      const created = await authenticatedRequest<ChatMessage>(`/v1/chat-rooms/${roomId}/messages`, {
        method: "POST",
        body,
      });
      if (!mountedRef.current || generationRef.current !== generation) return;

      setMessages((current) => mergeMessages(current, [created]));
      cursorRef.current = Math.max(cursorRef.current, created.id);
      setMessageText("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNotice("ส่งข้อความแล้ว");

      const refreshed = await loadMessages(
        roomId,
        previousCursor,
        generation,
        "ส่งข้อความแล้ว แต่โหลดข้อความล่าสุดไม่สำเร็จ",
      );
      if (mountedRef.current && generationRef.current === generation) {
        retryCursorRef.current = refreshed ? null : previousCursor;
      }
    } catch (error) {
      if (mountedRef.current && generationRef.current === generation) {
        setComposerError(error instanceof Error ? error.message : "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่");
      }
    } finally {
      sendLockRef.current = false;
      if (mountedRef.current && generationRef.current === generation) setSending(false);
    }
  }

  async function retryMessages() {
    if (!selectedBooking?.chatRoomId || retrying) return;
    const generation = generationRef.current;
    const afterId = retryCursorRef.current ?? cursorRef.current;
    setRetrying(true);
    setThreadLoading(true);
    const refreshed = await loadMessages(selectedBooking.chatRoomId, afterId, generation);
    if (refreshed) retryCursorRef.current = null;
    if (mountedRef.current && generationRef.current === generation) setRetrying(false);
  }

  async function openAttachment(message: ChatMessage) {
    if (!message.attachment || openingAttachment !== null) return;
    const generation = generationRef.current;
    setOpeningAttachment(message.id);
    setAttachmentError("");
    try {
      await openProtectedFile(message.attachment.url);
    } catch (error) {
      if (mountedRef.current && generationRef.current === generation) {
        setAttachmentError(error instanceof Error ? error.message : "เปิดไฟล์แนบไม่สำเร็จ");
      }
    } finally {
      if (mountedRef.current && generationRef.current === generation) setOpeningAttachment(null);
    }
  }

  if (roomsLoading && rooms.length === 0) {
    return <section className="queue-loading" aria-live="polite">กำลังโหลดห้องสนทนา…</section>;
  }

  if (roomsError && rooms.length === 0) {
    return (
      <div className="workbench-error" role="alert">
        <span>{roomsError}</span>
        <button type="button" disabled={roomsLoading} onClick={() => void loadRooms()}>
          <RefreshCw aria-hidden="true" size={16} /> {roomsLoading ? "กำลังโหลด…" : "ลองโหลดห้องใหม่"}
        </button>
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <section className="selection-missing" role="region" aria-labelledby="chat-empty-title">
        <MessageSquareText aria-hidden="true" size={28} />
        <h2 id="chat-empty-title">ยังไม่มีห้องสนทนาที่เปิดอ่านได้</h2>
        <p>ห้องสนทนาจะเปิดตามสถานะของคำขอจอง</p>
        <Link className="button button--dark" href="/member">กลับไปดูการจอง</Link>
      </section>
    );
  }

  if (!selectedBooking) return null;

  const readOnlyCopy = selectedBooking.status === "cancelled"
    ? "การจองนี้ถูกยกเลิกแล้ว จึงส่งข้อความเพิ่มไม่ได้"
    : "สถานะการจองนี้ยังไม่เปิดให้ส่งข้อความเพิ่ม";

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar" aria-labelledby="chat-room-list-title">
        <h2 id="chat-room-list-title">ห้องตามคำขอจอง</h2>
        {rooms.map((booking) => (
          <button
            className={`chat-contact${booking.id === selectedBooking.id ? " is-active" : ""}`}
            type="button"
            key={booking.id}
            aria-pressed={booking.id === selectedBooking.id}
            onClick={() => setSelectedBookingId(booking.id)}
          >
            <span aria-hidden="true">{initials(booking.trainer.displayName)}</span>
            <div>
              <strong>{booking.trainer.displayName}</strong>
              <small>{booking.id} · {bookingStatusCopy[booking.status]}</small>
            </div>
          </button>
        ))}
      </aside>

      <div className="dashboard-columns">
        <section className="chat-thread" aria-labelledby="chat-thread-title">
          <header>
            <div>
              <h2 id="chat-thread-title">{selectedBooking.trainer.displayName}</h2>
              <p>{selectedBooking.id}</p>
            </div>
            <strong className="status-dot">{bookingStatusCopy[selectedBooking.status]}</strong>
          </header>

          <div className="messages" aria-live="polite" aria-busy={threadLoading}>
            {threadLoading && messages.length === 0 && <p className="queue-loading">กำลังโหลดข้อความ…</p>}
            {!threadLoading && !threadError && messages.length === 0 && (
              <div className="empty-state">
                <strong>ยังไม่มีข้อความในห้องนี้</strong>
                <p>{selectedBooking.actions.canSendChat ? "เริ่มคุยเรื่องเวลา สถานที่ หรือการเตรียมตัวได้" : "ประวัติข้อความจะปรากฏที่นี่เมื่อมีการสนทนา"}</p>
              </div>
            )}
            {messages.map((message) => (
              <article className="ledger-row" data-testid="message-row" key={message.id}>
                <span>
                  <strong>{message.sender.displayName}</strong>
                  <small>{formatDateTime(message.createdAt)} · {message.readAt ? "อ่านแล้ว" : "ยังไม่อ่าน"}</small>
                </span>
                <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {message.message && <p>{message.message}</p>}
                  {message.attachment && (
                    <ul className="certificate-list">
                      <li>
                        <div>
                          <FileText aria-hidden="true" size={18} />
                          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                            <strong>{message.attachment.name}</strong>
                            <small>{readableMime(message.attachment.mime)} · {readableSize(message.attachment.size)}</small>
                          </span>
                        </div>
                        <button
                          className="certificate-action"
                          type="button"
                          disabled={openingAttachment !== null}
                          aria-label={`เปิดไฟล์ ${message.attachment.name}`}
                          onClick={() => void openAttachment(message)}
                        >
                          {openingAttachment === message.id ? "กำลังเปิด…" : "เปิดไฟล์"}
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>

          {threadError && (
            <div className="workbench-error" role="alert">
              <span>{threadError}</span>
              <button type="button" disabled={retrying} onClick={() => void retryMessages()}>
                <RefreshCw aria-hidden="true" size={15} /> {retrying ? "กำลังโหลด…" : "ลองโหลดข้อความใหม่"}
              </button>
            </div>
          )}
          {attachmentError && <div className="form-message form-message--error" role="alert">{attachmentError}</div>}
          {notice && <p className="queue-notice" role="status">{notice}</p>}

          {selectedBooking.actions.canSendChat ? (
            <form className="booking-fields" onSubmit={sendMessage} aria-busy={sending} noValidate>
              <div className="field">
                <label htmlFor="chat-message">ข้อความ</label>
                <textarea
                  id="chat-message"
                  value={messageText}
                  disabled={sending}
                  maxLength={4_000}
                  aria-invalid={Boolean(composerError)}
                  aria-describedby="chat-composer-guide chat-composer-feedback"
                  onChange={(event) => {
                    setMessageText(event.target.value);
                    setComposerError("");
                    setNotice("");
                  }}
                />
                <small id="chat-composer-guide">เขียนข้อความไม่เกิน 4,000 ตัวอักษร หรือส่งไฟล์อย่างเดียวได้</small>
              </div>
              <div className="field">
                <label htmlFor="chat-attachment"><Paperclip aria-hidden="true" size={16} /> ไฟล์แนบ</label>
                <input
                  ref={fileInputRef}
                  id="chat-attachment"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={sending}
                  aria-describedby="chat-attachment-guide chat-composer-feedback"
                  onChange={(event) => selectAttachment(event.target.files?.[0] ?? null)}
                />
                <small id="chat-attachment-guide">รองรับ JPEG, PNG, WebP หรือ PDF ขนาดไม่เกิน 5 MB</small>
              </div>

              {attachment && (
                <div className="ledger-row">
                  <span>ไฟล์ที่เลือก</span>
                  <div className="queue-actions" style={{ minWidth: 0 }}>
                    <strong style={{ minWidth: 0, overflowWrap: "anywhere" }}>{attachment.name}</strong>
                    <small>{readableMime(attachment.type)} · {readableSize(attachment.size)}</small>
                    <button type="button" disabled={sending} aria-label={`เอาไฟล์ ${attachment.name} ออก`} onClick={removeAttachment}>
                      <X aria-hidden="true" size={15} /> เอาไฟล์ออก
                    </button>
                  </div>
                </div>
              )}

              <div id="chat-composer-feedback" className="form-message-slot" aria-live="polite">
                {composerError && <div className="form-message form-message--error" role="alert">{composerError}</div>}
              </div>
              <button className="button button--accent" type="submit" disabled={sending}>
                <Send aria-hidden="true" size={17} /> {sending ? "กำลังส่ง…" : "ส่งข้อความ"}
              </button>
            </form>
          ) : (
            <div className="ledger-row">
              <span>การส่งข้อความ</span>
              <strong>{readOnlyCopy}</strong>
            </div>
          )}
        </section>

        <aside className="trainer-booking-list" aria-labelledby="chat-booking-facts-title">
          <div className="section-line-heading"><h2 id="chat-booking-facts-title">รายละเอียดนัดหมาย</h2></div>
          <div className="ledger-row"><span>รหัสคำขอ</span><strong>{selectedBooking.id}</strong></div>
          <div className="ledger-row"><span>วันและเวลา</span><strong>{formatDateTime(selectedBooking.startsAt)}</strong></div>
          <div className="ledger-row"><span>สิ้นสุด</span><strong>{formatDateTime(selectedBooking.endsAt)}</strong></div>
          <div className="ledger-row"><span>สถานที่</span><strong style={{ overflowWrap: "anywhere" }}>{selectedBooking.location}</strong></div>
          <div className="ledger-row"><span>สถานะการจอง</span><strong>{bookingStatusCopy[selectedBooking.status]}</strong></div>
          <div className="ledger-row"><span>สถานะหลักฐาน</span><strong>{paymentStatusCopy[selectedBooking.paymentStatus]}</strong></div>
          <div className="ledger-row"><span>ค่าฝึกที่แจ้ง</span><strong>{formatAmount(selectedBooking.quotedPrice)}</strong></div>
          <div className="ledger-row"><span>หมายเหตุ</span><strong style={{ overflowWrap: "anywhere" }}>{selectedBooking.note || "ไม่มีหมายเหตุ"}</strong></div>
        </aside>
      </div>
    </div>
  );
}
