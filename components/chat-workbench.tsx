"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: live chat workbench · genre: utilitarian athletic · theme: FitConnect workbench
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: uses locked FitConnect tokens
 */

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Lock,
  ExternalLink,
  FileImage,
  FileText,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError, apiAssetUrl, authHeaders, authenticatedRequest, openProtectedFile } from "@/lib/api";
import { formatDateTime, formatShortDay, initials } from "@/lib/format";
import { formatAmount, paymentStatusCopy } from "@/lib/payment-copy";
import { readStoredUser } from "@/lib/session";
import type { Booking, ChatMessage, UserRole } from "@/lib/types";

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const DESKTOP_FACTS_QUERY = "(min-width: 58.001rem)";
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ACCEPTED_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

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
    "image/gif": "GIF",
    "application/pdf": "PDF",
  };
  return known[mime] ?? (mime || "ไฟล์");
}

/**
 * The message payload keeps the legacy `attachment` object and adds the split
 * `image*` / `attachment*` fields from the contract. Both are read defensively
 * until `lib/types.ts` carries them.
 */
type MessageExtras = {
  imageUrl?: string | null;
  imageName?: string | null;
  imageSize?: number | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
};

type MessageImageSlot = { url: string; name: string | null; size: number | null };
type MessageFileSlot = { url: string; name: string; mime: string; size: number | null };

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "";
}

function messageSlots(message: ChatMessage): { image: MessageImageSlot | null; file: MessageFileSlot | null } {
  const extra = message as ChatMessage & MessageExtras;
  const image: MessageImageSlot | null = extra.imageUrl
    ? { url: extra.imageUrl, name: extra.imageName ?? null, size: extra.imageSize ?? null }
    : null;
  if (extra.attachmentUrl) {
    return {
      image,
      file: {
        url: extra.attachmentUrl,
        name: extra.attachmentName ?? "ไฟล์แนบ",
        mime: mimeFromName(extra.attachmentName ?? ""),
        size: extra.attachmentSize ?? null,
      },
    };
  }
  const legacy = message.attachment;
  if (!legacy) return { image, file: null };
  // A payload that still mirrors the single image in `attachment` must not
  // render the same picture twice; with no separate file URL the legacy card is
  // the image itself.
  const legacyIsImageMirror = image !== null && extra.imageName != null && legacy.name === extra.imageName;
  if (legacyIsImageMirror) return { image, file: null };
  return { image, file: { url: legacy.url, name: legacy.name, mime: legacy.mime, size: legacy.size } };
}

function formatDateDivider(value: string) {
  try {
    const date = new Date(value);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate();

    if (isToday) return "วันนี้";
    if (isYesterday) return "เมื่อวานนี้";

    return formatShortDay(value);
  } catch {
    return value;
  }
}

function isSameDay(a: string, b: string) {
  try {
    const d1 = new Date(a);
    const d2 = new Date(b);
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  } catch {
    return false;
  }
}

const CLOSED_STATUSES = new Set(["expired", "cancelled", "completed"]);

/** Open rooms first — the ones you can write in, then the ones waiting, then inquiries. */
function roomRank(room: Booking): number {
  if (CLOSED_STATUSES.has(room.status) && !room.inquiry) return 3;
  if (room.actions.canSendChat && !room.inquiry) return 0;
  if (room.inquiry) return 2;
  return 1;
}

function isClosedRoom(room: Booking) {
  return !room.inquiry && CLOSED_STATUSES.has(room.status);
}

const QUICK_REPLIES: Record<"member" | "trainer", string[]> = {
  member: ["สวัสดีครับ/ค่ะ ขอสอบถามรายละเอียดการฝึก", "ต้องเตรียมอะไรไปบ้าง"],
  trainer: ["สวัสดีครับ/ค่ะ ยินดีที่ได้ดูแลนะ", "ช่วยแจ้งเป้าหมายและข้อจำกัดด้านสุขภาพก่อนฝึก", "เจอกันที่สถานที่ฝึกตามนัดนะ"],
};

function readChatIdentity(): { id: number | null; role: UserRole | null } {
  // This surface only needs identity, not a guaranteed live token, so it reads
  // the cached user without the token gate the shell applies.
  const user = readStoredUser({ requireToken: false });
  return { id: user?.id ?? null, role: user?.role ?? null };
}

function chatPeer(booking: Booking, role: UserRole | null) {
  if (role === "trainer") {
    return {
      name: booking.member?.displayName ?? "สมาชิก",
      imageUrl: booking.member?.imageUrl,
      roleLabel: "สมาชิก",
      profileHref: null,
      member: booking.member,
    };
  }
  return {
    name: booking.trainer.displayName,
    imageUrl: booking.trainer.imageUrl,
    roleLabel: "เทรนเนอร์",
    profileHref: `/trainers/${booking.trainer.slug}`,
    member: undefined,
  };
}

function ChatAvatar({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl?: string | null;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const source = apiAssetUrl(imageUrl ?? null);
  return (
    <span className={className} aria-hidden="true">
      {source && !failed
        ? <Image src={source} alt="" width={44} height={44} unoptimized onError={() => setFailed(true)} />
        : initials(name)}
    </span>
  );
}

/**
 * A message image lives behind the participant guard, so it is fetched with the
 * session token and shown from a blob URL instead of a bare `<img src>` that the
 * guard would reject.
 */
function ChatMessageImage({
  image,
  opening,
  onOpen,
}: {
  image: MessageImageSlot;
  opening: boolean;
  onOpen: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const target = apiAssetUrl(image.url);
  const [failed, setFailed] = useState(() => target === null);

  useEffect(() => {
    if (!target) return;
    let active = true;
    let objectUrl: string | null = null;
    fetch(target, { headers: authHeaders() })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("โหลดรูปภาพไม่สำเร็จ"))))
      .then((blob) => {
        if (!active) return;
        if (typeof URL.createObjectURL !== "function") {
          setFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target]);

  const alt = image.name ?? "รูปภาพแนบในข้อความ";
  return (
    <div className="chat-message-image">
      {src && !failed ? (
        <img src={src} alt={alt} />
      ) : failed ? (
        <div className="chat-attachment-row">
          <div>
            <FileImage aria-hidden="true" size={18} />
            <span className="chat-breakable">
              <strong>{image.name ?? "รูปภาพแนบ"}</strong>
              <small>เปิดดูรูปภาพในการเชื่อมต่อที่ปลอดภัย</small>
            </span>
          </div>
          <button
            className="certificate-action"
            type="button"
            disabled={opening}
            aria-label={`เปิดรูปภาพ ${image.name ?? ""}`.trim()}
            onClick={onOpen}
          >
            {opening ? "กำลังเปิด…" : "เปิดรูปภาพ"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChatPeerProfile({
  bookingId,
  peer,
}: {
  bookingId: string;
  peer: ReturnType<typeof chatPeer>;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="chat-peer-profile-trigger"
          type="button"
          aria-label="ดูโปรไฟล์คู่สนทนา"
        >
          <UserRound aria-hidden="true" size={17} />
          ดูโปรไฟล์
        </button>
      </DialogTrigger>
      <DialogContent className="chat-peer-profile-dialog">
        <DialogHeader>
          <DialogTitle>โปรไฟล์ของ {peer.name}</DialogTitle>
          <DialogDescription>
            คู่สนทนาในคำขอ {bookingId}
          </DialogDescription>
        </DialogHeader>
        <div className="chat-peer-profile">
          <ChatAvatar className="chat-peer-profile__avatar" name={peer.name} imageUrl={peer.imageUrl} />
          <div>
            <span>{peer.roleLabel}</span>
            <strong>{peer.name}</strong>
            <p>แสดงเฉพาะข้อมูลที่ใช้ระบุตัวคู่สนทนาในคำขอนี้</p>
          </div>
        </div>
        {peer.member && (
          <dl>
            <div className="ledger-row"><dt>ระดับประสบการณ์</dt><dd>{({ beginner: "เริ่มต้น", intermediate: "มีประสบการณ์", advanced: "ฝึกสม่ำเสมอ" } as Record<string, string>)[peer.member.experienceLevel ?? ""] ?? "ยังไม่ระบุ"}</dd></div>
            <div className="ledger-row"><dt>น้ำหนัก</dt><dd>{peer.member.weight == null ? "ยังไม่ระบุ" : `${peer.member.weight} กก.`}</dd></div>
            <div className="ledger-row"><dt>ส่วนสูง</dt><dd>{peer.member.height == null ? "ยังไม่ระบุ" : `${peer.member.height} ซม.`}</dd></div>
            <div className="ledger-row"><dt>เป้าหมายการออกกำลังกาย</dt><dd className="chat-breakable">{peer.member.goals || "ยังไม่ระบุ"}</dd></div>
          </dl>
        )}
        {peer.profileHref && (
          <Link className="button button--accent chat-peer-profile__link" href={peer.profileHref}>
            ดูโปรไฟล์เทรนเนอร์ฉบับเต็ม
            <ExternalLink aria-hidden="true" size={16} />
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InquiryBadge() {
  return <span className="status-badge status-badge--inquiry">สอบถามก่อนจอง</span>;
}

type ChatWorkbenchProps = {
  initialBookingId?: string;
};

export function ChatWorkbench({ initialBookingId }: ChatWorkbenchProps) {
  const [rooms, setRooms] = useState<Booking[]>([]);
  const [roomQuery, setRoomQuery] = useState("");
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
  const [imageAttachment, setImageAttachment] = useState<File | null>(null);
  const [fileAttachment, setFileAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [openingAttachment, setOpeningAttachment] = useState<string | null>(null);
  const [factsOpen, setFactsOpen] = useState(false);
  // Phones show the list or the open room, never both squeezed together.
  const [mobileView, setMobileView] = useState<"list" | "thread">(initialBookingId ? "thread" : "list");
  const [{ id: currentUserId, role: currentUserRole }] = useState(readChatIdentity);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const messageRequestRef = useRef(0);
  const sendOperationRef = useRef(0);
  const retryOperationRef = useRef(0);
  const attachmentOperationRef = useRef(0);
  const cursorRef = useRef(0);
  const retryCursorRef = useRef<number | null>(null);
  const sendLockRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectedRoomRef = useRef<HTMLButtonElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);

  useEffect(() => {
    const container = messagesRef.current;
    if (container && followLatestRef.current) container.scrollTop = container.scrollHeight;
  }, [messages, threadLoading]);

  const selectedBooking = useMemo(
    () => rooms.find((booking) => booking.id === selectedBookingId) ?? null,
    [rooms, selectedBookingId],
  );
  const visibleRooms = useMemo(() => {
    const query = roomQuery.trim().toLocaleLowerCase("th-TH");
    if (!query) return rooms;
    return rooms.filter((booking) => (
      `${booking.trainer.displayName} ${booking.member?.displayName ?? ""} ${booking.id}`
        .toLocaleLowerCase("th-TH")
        .includes(query)
    ));
  }, [roomQuery, rooms]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!selectedBookingId || typeof window.matchMedia !== "function") return;
    if (window.matchMedia(DESKTOP_FACTS_QUERY).matches) return;
    selectedRoomRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedBookingId]);

  const loadRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError("");
    try {
      // Booking rooms and pre-booking inquiry rooms share one list. An older
      // API without inquiry rooms simply contributes none.
      const [bookings, inquiries] = await Promise.all([
        authenticatedRequest<Booking[]>("/v1/bookings"),
        authenticatedRequest<Booking[]>("/v1/chat-rooms").catch(() => [] as Booking[]),
      ]);
      if (!mountedRef.current) return;
      const readableRooms = [
        ...bookings.filter(
          (booking): booking is Booking & { chatRoomId: number } => booking.chatRoomId !== null && booking.actions.canReadChat,
        ),
        ...(Array.isArray(inquiries) ? inquiries : []).filter((room) => room.inquiry && typeof room.chatRoomId === "number"),
      ];
      const ordered = readableRooms
        .map((room, index) => ({ room, index }))
        .sort((left, right) => roomRank(left.room) - roomRank(right.room) || left.index - right.index)
        .map(({ room }) => room);
      setRooms(ordered);
      setSelectedBookingId((current) => {
        if (current && ordered.some((booking) => booking.id === current)) return current;
        if (initialBookingId && ordered.some((booking) => booking.id === initialBookingId)) return initialBookingId;
        // Land on a room the reader can actually write in.
        return ordered[0]?.id ?? "";
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
    const request = messageRequestRef.current + 1;
    messageRequestRef.current = request;
    try {
      const incoming = await authenticatedRequest<ChatMessage[]>(
        `/v1/chat-rooms/${roomId}/messages?afterId=${afterId}`,
      );
      if (!mountedRef.current || generationRef.current !== generation) return false;
      setMessages((current) => mergeMessages(current, incoming));
      if (incoming.length > 0) {
        cursorRef.current = Math.max(cursorRef.current, ...incoming.map((message) => message.id));
      }
      if (messageRequestRef.current === request) setThreadError("");
      return true;
    } catch {
      if (
        mountedRef.current
        && generationRef.current === generation
        && messageRequestRef.current === request
      ) {
        setThreadError(failureMessage);
      }
      return false;
    } finally {
      if (
        mountedRef.current
        && generationRef.current === generation
        && messageRequestRef.current === request
      ) {
        setThreadLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedBooking?.chatRoomId === null || selectedBooking?.chatRoomId === undefined) {
      return;
    }

    const roomId = selectedBooking.chatRoomId;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    messageRequestRef.current += 1;
    sendOperationRef.current += 1;
    retryOperationRef.current += 1;
    attachmentOperationRef.current += 1;
    cursorRef.current = 0;
    retryCursorRef.current = null;
    followLatestRef.current = true;
    sendLockRef.current = false;
    queueMicrotask(() => {
      if (!mountedRef.current || generationRef.current !== generation) return;
      setMessages([]);
      setThreadError("");
      setComposerError("");
      setAttachmentError("");
      setNotice("");
      setMessageText("");
      setImageAttachment(null);
      setFileAttachment(null);
      setSending(false);
      setRetrying(false);
      setOpeningAttachment(null);
      setThreadLoading(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (imageInputRef.current) imageInputRef.current.value = "";
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

  function selectImage(file: File | null) {
    setNotice("");
    setComposerError("");
    if (!file) {
      setImageAttachment(null);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setImageAttachment(null);
      setComposerError("รองรับเฉพาะ JPEG, PNG, WebP หรือ GIF");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setImageAttachment(null);
      setComposerError("รูปภาพต้องมีขนาดไม่เกิน 5 MB");
      if (imageInputRef.current) imageInputRef.current.value = "";
      return;
    }
    setImageAttachment(file);
  }

  function selectFile(file: File | null) {
    setNotice("");
    setComposerError("");
    if (!file) {
      setFileAttachment(null);
      return;
    }
    if (!ACCEPTED_FILE_TYPES.has(file.type)) {
      setFileAttachment(null);
      setComposerError("รองรับเฉพาะ JPEG, PNG, WebP, GIF หรือ PDF");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setFileAttachment(null);
      setComposerError("ไฟล์ต้องมีขนาดไม่เกิน 5 MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFileAttachment(file);
  }

  function removeImage() {
    setImageAttachment(null);
    setComposerError("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function removeFile() {
    setFileAttachment(null);
    setComposerError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendLockRef.current || !selectedBooking?.chatRoomId || !selectedBooking.actions.canSendChat) return;

    const trimmedMessage = messageText.trim();
    if (!trimmedMessage && !imageAttachment && !fileAttachment) {
      setComposerError("กรุณาพิมพ์ข้อความหรือแนบไฟล์");
      return;
    }

    const roomId = selectedBooking.chatRoomId;
    const generation = generationRef.current;
    const operation = sendOperationRef.current + 1;
    sendOperationRef.current = operation;
    const previousCursor = cursorRef.current;
    const body = new FormData();
    if (trimmedMessage) {
      body.set("text", trimmedMessage);
      // Legacy key kept as an alias so one multipart message works against the
      // old `message` reader and the contract's `text` reader alike.
      body.set("message", trimmedMessage);
    }
    if (imageAttachment) body.set("image", imageAttachment);
    if (fileAttachment) body.set("file", fileAttachment);

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
      if (
        !mountedRef.current
        || generationRef.current !== generation
        || sendOperationRef.current !== operation
      ) return;

      followLatestRef.current = true;
      setMessages((current) => mergeMessages(current, [created]));
      cursorRef.current = Math.max(cursorRef.current, created.id);
      setMessageText("");
      setImageAttachment(null);
      setFileAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (imageInputRef.current) imageInputRef.current.value = "";
      setNotice("ส่งข้อความแล้ว");

      const refreshed = await loadMessages(
        roomId,
        previousCursor,
        generation,
        "ส่งข้อความแล้ว แต่โหลดข้อความล่าสุดไม่สำเร็จ",
      );
      if (
        mountedRef.current
        && generationRef.current === generation
        && sendOperationRef.current === operation
      ) {
        retryCursorRef.current = refreshed ? null : previousCursor;
      }
    } catch (error) {
      if (
        mountedRef.current
        && generationRef.current === generation
        && sendOperationRef.current === operation
      ) {
        setComposerError(error instanceof Error ? error.message : "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่");
        if (error instanceof ApiError && error.code === "CHAT_READ_ONLY") void loadRooms();
      }
    } finally {
      if (sendOperationRef.current === operation) {
        sendLockRef.current = false;
        if (mountedRef.current && generationRef.current === generation) setSending(false);
      }
    }
  }

  async function retryMessages() {
    if (!selectedBooking?.chatRoomId || retrying) return;
    const generation = generationRef.current;
    const operation = retryOperationRef.current + 1;
    retryOperationRef.current = operation;
    const afterId = retryCursorRef.current ?? cursorRef.current;
    setRetrying(true);
    setThreadLoading(true);
    const refreshed = await loadMessages(selectedBooking.chatRoomId, afterId, generation);
    if (
      mountedRef.current
      && generationRef.current === generation
      && retryOperationRef.current === operation
    ) {
      if (refreshed) retryCursorRef.current = null;
      setRetrying(false);
    }
  }

  async function openAttachment(target: MessageFileSlot | MessageImageSlot) {
    if (openingAttachment !== null) return;
    const generation = generationRef.current;
    const operation = attachmentOperationRef.current + 1;
    attachmentOperationRef.current = operation;
    setOpeningAttachment(target.url);
    setAttachmentError("");
    try {
      await openProtectedFile(target.url);
    } catch (error) {
      if (
        mountedRef.current
        && generationRef.current === generation
        && attachmentOperationRef.current === operation
      ) {
        setAttachmentError(error instanceof Error ? error.message : "เปิดไฟล์แนบไม่สำเร็จ");
      }
    } finally {
      if (
        mountedRef.current
        && generationRef.current === generation
        && attachmentOperationRef.current === operation
      ) {
        setOpeningAttachment(null);
      }
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
        <p>เริ่มแชทได้จากหน้าโปรไฟล์เทรนเนอร์ หรือห้องจะเปิดเองเมื่อมีคำขอจอง</p>
        <Link className="button button--dark" href="/member">กลับไปดูการจอง</Link>
      </section>
    );
  }

  if (!selectedBooking) return null;
  const selectedPeer = chatPeer(selectedBooking, currentUserRole);

  const readOnlyCopy = selectedBooking.status === "completed"
    ? "การฝึกครั้งนี้เสร็จสิ้นแล้ว อ่านประวัติได้แต่ส่งข้อความเพิ่มไม่ได้"
    : selectedBooking.status === "cancelled"
    ? "การจองนี้ถูกยกเลิกแล้ว จึงส่งข้อความเพิ่มไม่ได้"
    : selectedBooking.status === "expired"
      ? "การจองหมดเวลาแล้ว ประวัติยังอ่านได้แต่ส่งข้อความเพิ่มไม่ได้"
    : selectedBooking.status === "pending_trainer"
      ? currentUserRole === "trainer"
        ? "ห้องนี้เปิดให้พิมพ์หลังคุณตอบรับและระบบแจ้งยืนยันสมาชิกในรอบ 12:00 หรือ 18:00 น."
        : "ห้องนี้เปิดให้พิมพ์หลังเทรนเนอร์ตอบรับและระบบแจ้งยืนยันในรอบ 12:00 หรือ 18:00 น."
    : "สถานะการจองนี้ยังไม่เปิดให้ส่งข้อความเพิ่ม";

  const selectedId = selectedBooking.id;
  function renderRoom(booking: Booking) {
            const peer = chatPeer(booking, currentUserRole);
            return (
              <button
                className={`chat-contact${booking.id === selectedId ? " is-active" : ""}${booking.actions.canSendChat ? " is-open" : ""}`}
                type="button"
                key={booking.id}
                ref={booking.id === selectedId ? selectedRoomRef : undefined}
                aria-pressed={booking.id === selectedId}
                onClick={() => {
                  setFactsOpen(false);
                  setSelectedBookingId(booking.id);
                  setMobileView("thread");
                }}
              >
                <ChatAvatar className="chat-contact__avatar" name={peer.name} imageUrl={peer.imageUrl} />
                <div className="chat-contact__body">
                  <strong>{peer.name}</strong>
                  <time className="chat-contact__appointment" dateTime={booking.startsAt}>
                    {booking.inquiry ? `ล่าสุด ${formatDateTime(booking.startsAt)}` : formatDateTime(booking.startsAt)}
                  </time>
                  <div className="chat-contact__meta">
                    <small>{booking.inquiry ? "ก่อนจอง" : booking.id}</small>
                    {booking.inquiry ? <InquiryBadge /> : <StatusBadge status={booking.status} />}
                  </div>
                </div>
              </button>
            );
  }

  const openRooms = visibleRooms.filter((room) => !isClosedRoom(room));
  const closedRooms = visibleRooms.filter(isClosedRoom);
  const inquiryWithTrainer = rooms.find((room) => room.inquiry && room.trainer.id === selectedBooking.trainer.id && room.id !== selectedBooking.id);
  const quickReplies = QUICK_REPLIES[currentUserRole === "trainer" ? "trainer" : "member"];

  return (
    <div className={`chat-guided-layout chat-guided-layout--${mobileView}`}>
      <aside className="chat-room-list" aria-label="ห้องสนทนา">
        <div className="chat-room-list__heading">
          <h2>ข้อความ</h2>
          <span>{rooms.length} ห้อง</span>
        </div>
        <label className="chat-room-search" htmlFor="chat-room-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">ค้นหาห้องสนทนา</span>
          <input
            id="chat-room-search"
            type="search"
            value={roomQuery}
            placeholder="ค้นหาชื่อหรือรหัสคำขอ"
            onChange={(event) => setRoomQuery(event.target.value)}
          />
        </label>
        <div className="chat-room-list__items">
          {openRooms.map(renderRoom)}
          {closedRooms.length > 0 && (
            <details className="chat-room-list__closed" open={closedRooms.some((room) => room.id === selectedBooking.id) || undefined}>
              <summary>ห้องที่ปิดแล้ว <span>{closedRooms.length}</span><ChevronDown aria-hidden="true" size={16} /></summary>
              {closedRooms.map(renderRoom)}
            </details>
          )}
          {visibleRooms.length === 0 && <p className="chat-room-list__empty" role="status">ไม่พบห้องสนทนาที่ตรงกับคำค้นหา</p>}
        </div>
      </aside>

      <section className="chat-conversation chat-thread" aria-labelledby="chat-thread-title">
        <header className="chat-thread-header">
          <div className="chat-thread__heading">
            <button className="chat-thread__back" type="button" aria-label="กลับไปที่รายการห้อง" onClick={() => setMobileView("list")}>
              <ArrowLeft aria-hidden="true" size={20} />
            </button>
            <div className="chat-thread__peer-card">
              <ChatAvatar className="chat-thread__peer-avatar" name={selectedPeer.name} imageUrl={selectedPeer.imageUrl} />
              <div className="chat-thread__peer-meta">
                <div className="chat-thread__peer-title">
                  <h2 id="chat-thread-title"><span className="sr-only">สนทนากับ</span>{" "}{selectedPeer.name}</h2>
                </div>
                <p>{selectedPeer.roleLabel} · {selectedBooking.inquiry ? "สอบถามก่อนจอง" : selectedBooking.id}</p>
              </div>
            </div>
            <ChatPeerProfile bookingId={selectedBooking.id} peer={selectedPeer} />
          </div>
          {selectedBooking.inquiry ? <InquiryBadge /> : <StatusBadge status={selectedBooking.status} />}
        </header>

        {selectedBooking.inquiry ? (
          <div className="chat-inquiry-note">
            <MessageSquareText aria-hidden="true" size={18} />
            <p>
              ห้องนี้ใช้สอบถามและตกลงรายละเอียดก่อนจอง
              {currentUserRole === "member" && selectedBooking.trainer.slug && (
                <> · <Link href={`/trainers/${selectedBooking.trainer.slug}`}>ไปหน้าเทรนเนอร์เพื่อจอง</Link></>
              )}
            </p>
          </div>
        ) : (
        <details
          key={selectedBooking.id}
          className="trainer-booking-list chat-booking-facts"
          open={factsOpen}
          onToggle={(event) => setFactsOpen(event.currentTarget.open)}
        >
          <summary className="chat-booking-facts__summary">
            รายละเอียดนัดหมาย
            <span>{formatDateTime(selectedBooking.startsAt)}</span>
          </summary>
          <div className="ledger-row"><span>รหัสคำขอ</span><strong className="chat-breakable">{selectedBooking.id}</strong></div>
          <div className="ledger-row"><span>นัดหมาย</span><strong>{formatDateTime(selectedBooking.startsAt)}</strong></div>
          <div className="ledger-row"><span>สถานะหลักฐาน</span><strong>{paymentStatusCopy[selectedBooking.paymentStatus]}</strong></div>
          <div className="ledger-row"><span>{selectedBooking.bookingType === "monthly" ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง"}</span><strong>{formatAmount(selectedBooking.quotedPrice)}</strong></div>
          {selectedBooking.bookingType === "monthly" && <div className="ledger-row"><span>จำนวนครั้ง</span><strong>{selectedBooking.sessionCount ?? selectedBooking.sessions?.length ?? 0} ครั้ง ภายใน 30 วัน</strong></div>}
          <div className="ledger-row"><span>หมายเหตุ</span><strong className="chat-breakable">{selectedBooking.note || "ไม่มีหมายเหตุ"}</strong></div>
        </details>
        )}

        <div
          className="messages"
          ref={messagesRef}
          onScroll={(event) => {
            const container = event.currentTarget;
            followLatestRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 64;
          }}
          role="log"
          aria-label={`ข้อความกับ ${selectedPeer.name}`}
          aria-live="polite"
          aria-busy={threadLoading}
        >
          {threadLoading && messages.length === 0 && <p className="queue-loading">กำลังโหลดข้อความ…</p>}
          {!threadLoading && !threadError && messages.length === 0 && (
            <div className="empty-state">
              <strong>ยังไม่มีข้อความในห้องนี้</strong>
              <p>{selectedBooking.actions.canSendChat ? "เริ่มคุยเรื่องเวลาและการเตรียมตัวได้" : "ประวัติข้อความจะปรากฏที่นี่เมื่อมีการสนทนา"}</p>
              {selectedBooking.actions.canSendChat && (
                <div className="chat-quick-replies" aria-label="ข้อความเริ่มต้น">
                  {quickReplies.map((reply) => (
                    <button key={reply} type="button" onClick={() => setMessageText(reply)}>{reply}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((message, index) => {
            const mine = currentUserId !== null && message.sender.id === currentUserId;
            const { image: imageSlot, file: fileSlot } = messageSlots(message);
            const previous = messages[index - 1];
            const stacked = previous?.sender.id === message.sender.id && isSameDay(previous.createdAt, message.createdAt);
            const showDateDivider = !previous || !isSameDay(previous.createdAt, message.createdAt);
            const lastOwnMessageId = messages.reduce<number | null>(
              (id, item) => (currentUserId !== null && item.sender.id === currentUserId ? item.id : id),
              null,
            );
            const lastMine = mine && lastOwnMessageId === message.id;
            return (
              <div key={message.id} className="chat-message-group">
                {showDateDivider && (
                  <div className="chat-date-divider" role="separator" aria-label={`วันที่ ${formatDateDivider(message.createdAt)}`}>
                    <span>{formatDateDivider(message.createdAt)}</span>
                  </div>
                )}
                <article className={`chat-message chat-message--${mine ? "mine" : "other"}${stacked ? " is-stacked" : ""}`} data-testid="message-row">
                  {stacked
                    ? <span className="chat-message__avatar chat-message__avatar--spacer" aria-hidden="true" />
                    : <span className="chat-message__avatar" aria-hidden="true">{initials(message.sender.displayName)}</span>}
                  <div className="chat-message__stack">
                    <div className="chat-message__bubble chat-message-content">
                      {message.message && <p>{message.message}</p>}
                      {imageSlot && (
                        <ChatMessageImage
                          image={imageSlot}
                          opening={openingAttachment === imageSlot.url}
                          onOpen={() => void openAttachment(imageSlot)}
                        />
                      )}
                      {fileSlot && (
                        <ul className="certificate-list">
                          <li className="chat-attachment-row">
                            <div>
                              <FileText aria-hidden="true" size={18} />
                              <span className="chat-breakable">
                                <strong>{fileSlot.name}</strong>
                                <small>{readableMime(fileSlot.mime)}{fileSlot.size === null ? "" : ` · ${readableSize(fileSlot.size)}`}</small>
                              </span>
                            </div>
                            <button
                              className="certificate-action"
                              type="button"
                              disabled={openingAttachment !== null}
                              aria-label={`เปิดไฟล์ ${fileSlot.name}`}
                              onClick={() => void openAttachment(fileSlot)}
                            >
                              {openingAttachment === fileSlot.url ? "กำลังเปิด…" : "เปิดไฟล์"}
                            </button>
                          </li>
                        </ul>
                      )}
                    </div>
                    <p className="chat-message__meta">
                      <small title={formatDateTime(message.createdAt)}>
                        {formatDateTime(message.createdAt)}
                        {lastMine ? (
                          <span className="chat-read-receipt">
                            {message.readAt ? (
                              <>
                                <CheckCheck aria-hidden="true" size={13} className="read-icon read-icon--read" />
                                <span> · อ่านแล้ว</span>
                              </>
                            ) : (
                              <>
                                <Check aria-hidden="true" size={13} className="read-icon" />
                                <span> · ยังไม่อ่าน</span>
                              </>
                            )}
                          </span>
                        ) : ""}
                      </small>
                    </p>
                  </div>
                </article>
              </div>
            );
          })}
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
          <form
            className="chat-composer"
            aria-label={`เขียนข้อความถึง ${selectedPeer.name}`}
            onSubmit={sendMessage}
            aria-busy={sending}
            noValidate
          >
            <div className="chat-composer__bar">
              <div className="chat-composer__field">
                <button
                  className="icon-button"
                  type="button"
                  disabled={sending}
                  aria-label="แนบรูปภาพ"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <FileImage aria-hidden="true" size={18} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={sending}
                  aria-label="แนบไฟล์"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip aria-hidden="true" size={18} />
                </button>
                <label className="sr-only" htmlFor="chat-message">ข้อความ</label>
                <textarea
                  id="chat-message"
                  value={messageText}
                  disabled={sending}
                  maxLength={4_000}
                  rows={1}
                  placeholder="พิมพ์ข้อความ…"
                  aria-invalid={Boolean(composerError)}
                  aria-describedby="chat-composer-guide chat-composer-feedback"
                  onChange={(event) => {
                    setMessageText(event.target.value);
                    setComposerError("");
                    setNotice("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </div>
              <button className="button button--accent" type="submit" disabled={sending}>
                <Send aria-hidden="true" size={17} /> {sending ? "กำลังส่ง…" : "ส่งข้อความ"}
              </button>
            </div>
            <small className="sr-only" id="chat-composer-guide">เขียนข้อความไม่เกิน 4,000 ตัวอักษร แนบรูปภาพหนึ่งไฟล์และไฟล์อื่นอีกหนึ่งไฟล์พร้อมกันได้</small>
            <label className="sr-only" htmlFor="chat-image">รูปภาพแนบ</label>
            <input
              className="sr-only"
              ref={imageInputRef}
              id="chat-image"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={sending}
              aria-describedby="chat-image-guide chat-composer-feedback"
              onChange={(event) => selectImage(event.target.files?.[0] ?? null)}
            />
            <small className="sr-only" id="chat-image-guide">รองรับ JPEG, PNG, WebP หรือ GIF ขนาดไม่เกิน 5 MB</small>
            <label className="sr-only" htmlFor="chat-attachment">ไฟล์แนบ</label>
            <input
              className="sr-only"
              ref={fileInputRef}
              id="chat-attachment"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              disabled={sending}
              aria-describedby="chat-attachment-guide chat-composer-feedback"
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            />
            <small className="sr-only" id="chat-attachment-guide">รองรับ JPEG, PNG, WebP, GIF หรือ PDF ขนาดไม่เกิน 5 MB</small>

            {imageAttachment && (
              <div className="ledger-row">
                <span>รูปภาพที่เลือก</span>
                <div className="queue-actions chat-selected-file">
                  <strong className="chat-breakable">{imageAttachment.name}</strong>
                  <small>{readableMime(imageAttachment.type)} · {readableSize(imageAttachment.size)}</small>
                  <button type="button" disabled={sending} aria-label={`เอารูปภาพ ${imageAttachment.name} ออก`} onClick={removeImage}>
                    <X aria-hidden="true" size={15} /> เอารูปภาพออก
                  </button>
                </div>
              </div>
            )}

            {fileAttachment && (
              <div className="ledger-row">
                <span>ไฟล์ที่เลือก</span>
                <div className="queue-actions chat-selected-file">
                  <strong className="chat-breakable">{fileAttachment.name}</strong>
                  <small>{readableMime(fileAttachment.type)} · {readableSize(fileAttachment.size)}</small>
                  <button type="button" disabled={sending} aria-label={`เอาไฟล์ ${fileAttachment.name} ออก`} onClick={removeFile}>
                    <X aria-hidden="true" size={15} /> เอาไฟล์ออก
                  </button>
                </div>
              </div>
            )}

            <div id="chat-composer-feedback" className="form-message-slot" aria-live="polite">
              {composerError && <div className="form-message form-message--error" role="alert">{composerError}</div>}
            </div>
          </form>
        ) : (
          <div className="chat-composer-locked" role="note">
            <Lock aria-hidden="true" size={18} />
            <p>{readOnlyCopy}</p>
            {selectedBooking.status === "pending_trainer" && currentUserRole === "member" && (
              inquiryWithTrainer
                ? <button className="button button--outline" type="button" onClick={() => { setSelectedBookingId(inquiryWithTrainer.id); setMobileView("thread"); }}>ไปห้องสอบถามก่อนจอง</button>
                : <Link className="button button--outline" href={`/trainers/${selectedBooking.trainer.slug}`}>สอบถามจากหน้าเทรนเนอร์</Link>
            )}
            {selectedBooking.status === "pending_trainer" && currentUserRole === "trainer" && (
              <Link className="button button--outline" href={`/trainer#request-${selectedBooking.id}`}>ไปตอบคำขอ</Link>
            )}
            {selectedBooking.status === "completed" && currentUserRole === "member" && (
              <Link className="button button--accent" href={`/trainers/${selectedBooking.trainer.slug}`}>จองอีกครั้ง</Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
