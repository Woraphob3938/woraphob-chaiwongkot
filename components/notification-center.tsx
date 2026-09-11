"use client";

/* Hallmark · Master Detail · inherits DESIGN.md Athlete Credential system
 * states: loading · ready · error · empty · unread · selected · disabled · success
 * contrast: inherited tokens · motion: one 180ms selection cue
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  CalendarCheck,
  CalendarClock,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  Search,
} from "lucide-react";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { formatDateTime, formatDay } from "@/lib/format";
import type {
  NotificationCategory,
  NotificationDetail,
  NotificationItem,
  NotificationListResponse,
} from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";

type LoadState = "loading" | "ready" | "error";
type LoadErrorKind = "auth" | "connection" | "server";

const categories: Array<{ key: NotificationCategory; label: string; icon: typeof Bell }> = [
  { key: "all", label: "ทั้งหมด", icon: Bell },
  { key: "booking", label: "การจอง", icon: CalendarClock },
  { key: "payment", label: "การชำระเงิน", icon: CreditCard },
  { key: "appointment", label: "นัดหมาย", icon: CalendarCheck },
];

const emptyResponse: NotificationListResponse = {
  items: [],
  unread: { all: 0, booking: 0, payment: 0, appointment: 0 },
  pagination: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
};

const bookingStatus: Record<string, string> = {
  awaiting_payment: "รอชำระเงิน",
  payment_review: "กำลังตรวจการชำระเงิน",
  confirmed: "ยืนยันแล้ว",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
  expired: "หมดเวลา",
};

function formatRelativeTime(value: string) {
  try {
    const date = new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return formatDateTime(value);
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHour / 24);

    if (diffMin < 1) return "เมื่อสักครู่";
    if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
    if (diffHour < 24) return `${diffHour} ชม. ที่แล้ว`;
    if (diffDays === 1) return "เมื่อวานนี้";
    if (diffDays < 7) return `${diffDays} วันที่แล้ว`;

    return formatDay(value);
  } catch {
    return value;
  }
}

function getCategoryIcon(category: NotificationItem["category"]) {
  switch (category) {
    case "payment":
      return CreditCard;
    case "appointment":
      return CalendarCheck;
    case "booking":
      return CalendarClock;
    default:
      return Bell;
  }
}

function isUrgentNotification(item: NotificationItem) {
  const text = `${item.title} ${item.message}`.toLowerCase();
  return (
    text.includes("รอชำระเงิน") ||
    text.includes("รอการชำระเงิน") ||
    text.includes("ไม่ผ่าน") ||
    text.includes("ปฏิเสธ") ||
    text.includes("10 นาที") ||
    item.type.includes("payment_rejected") ||
    item.type.includes("deadline")
  );
}

function categoryLabel(category: NotificationItem["category"]) {
  return categories.find((entry) => entry.key === category)?.label ?? "การแจ้งเตือน";
}

function safeInternalPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
  const base = "https://fitconnect.local";
  const url = new URL(path, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
}

function loadErrorKind(error: unknown): LoadErrorKind {
  if (error instanceof ApiError && error.status === 401) return "auth";
  if (error instanceof ApiError && error.status === 503) return "connection";
  return "server";
}

function categoryAccessibleLabel(label: string, unread: number) {
  return unread > 0 ? `${label} มี ${unread} รายการที่ยังไม่ได้อ่าน` : `${label} ไม่มีรายการที่ยังไม่ได้อ่าน`;
}

function actionLabel(detail: NotificationDetail) {
  if (detail.actionPath === "/admin" || detail.actionPath.startsWith("/admin#")) {
    return detail.booking.status === "payment_review" ? "ตรวจสอบการชำระเงิน" : "ดูการจองในหน้าผู้ดูแลระบบ";
  }
  if (detail.booking.status === "completed") return "เขียนรีวิว";
  if (
    detail.booking.status === "awaiting_payment"
    && ["not_submitted", "rejected"].includes(detail.booking.paymentStatus)
  ) return "ส่งหลักฐานการชำระเงิน";
  if (detail.booking.status === "payment_review") return "ดูสถานะการชำระเงิน";
  if (detail.booking.status === "confirmed" || detail.actionPath.startsWith("/trainer")) return "ดูตารางนัดหมาย";
  if (["cancelled", "expired"].includes(detail.booking.status) || detail.actionPath.startsWith("/trainers")) {
    return "ค้นหาเทรนเนอร์";
  }
  return "ดูการจอง";
}

function PaymentStatusBadge({ status }: { status: NotificationDetail["booking"]["paymentStatus"] }) {
  if (status === "not_submitted") {
    return (
      <span className="status-badge status-badge--warning">
        <Clock3 aria-hidden="true" size={15} strokeWidth={2} />
        ยังไม่ส่งหลักฐาน
      </span>
    );
  }
  return <StatusBadge status={status} />;
}

function LoadError({ kind, onRetry }: { kind: LoadErrorKind; onRetry: () => void }) {
  if (kind === "auth") {
    return (
      <Alert variant="destructive" className="notification-center__error">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>กรุณาเข้าสู่ระบบอีกครั้ง</AlertTitle>
        <AlertDescription>เซสชันของคุณหมดอายุแล้ว เข้าสู่ระบบเพื่อดูการแจ้งเตือนล่าสุด</AlertDescription>
        <Button asChild><Link href="/login">เข้าสู่ระบบ</Link></Button>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="notification-center__error">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{kind === "connection" ? "เชื่อมต่อ FitConnect ไม่ได้" : "โหลดการแจ้งเตือนไม่สำเร็จ"}</AlertTitle>
      <AlertDescription>
        {kind === "connection"
          ? "บริการยังไม่พร้อม โปรดตรวจการเชื่อมต่อหรือเปิด Apache แล้วลองอีกครั้ง"
          : "ระบบมีปัญหาชั่วคราว กรุณาลองโหลดรายการอีกครั้ง"}
      </AlertDescription>
      <Button type="button" variant="outline" onClick={onRetry}>ลองใหม่</Button>
    </Alert>
  );
}

export function NotificationCenter() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [response, setResponse] = useState<NotificationListResponse>(emptyResponse);
  const [category, setCategory] = useState<NotificationCategory>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NotificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [loadError, setLoadError] = useState<LoadErrorKind | null>(null);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectionRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const loadNotifications = useCallback(async () => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    const refreshing = hasLoadedRef.current;
    setLoadError(null);
    if (refreshing) setListRefreshing(true);
    else setLoadState("loading");
    try {
      const nextResponse = await authenticatedRequest<NotificationListResponse>(
        `/v1/notifications?page=${page}&category=${category}&unread=${unreadOnly}`,
      );
      if (listRequestRef.current !== requestId) return;
      setResponse(nextResponse);
      hasLoadedRef.current = true;
      setLoadState("ready");
    } catch (error) {
      if (listRequestRef.current !== requestId) return;
      setLoadError(loadErrorKind(error));
      setLoadState(refreshing ? "ready" : "error");
    } finally {
      if (listRequestRef.current === requestId) setListRefreshing(false);
    }
  }, [category, page, unreadOnly]);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!active) return;
      await loadNotifications();
    }
    void run();
    return () => { active = false; };
  }, [loadNotifications, reloadVersion]);

  function updateCategory(nextCategory: NotificationCategory) {
    selectionRequestRef.current += 1;
    setCategory(nextCategory);
    setPage(0);
    setSelectedId(null);
    setDetail(null);
    setLoadError(null);
  }

  function updateUnreadFilter() {
    selectionRequestRef.current += 1;
    setUnreadOnly((current) => !current);
    setPage(0);
    setSelectedId(null);
    setDetail(null);
    setLoadError(null);
  }

  function resetFilters() {
    selectionRequestRef.current += 1;
    setCategory("all");
    setUnreadOnly(false);
    setSearchQuery("");
    setPage(0);
    setSelectedId(null);
    setDetail(null);
    setLoadError(null);
  }

  async function openNotification(item: NotificationItem) {
    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;
    setSelectedId(item.id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const nextDetail = await authenticatedRequest<NotificationDetail>(`/v1/notifications/${item.id}`);
      if (selectionRequestRef.current !== requestId) return;
      setDetail(nextDetail);
      if (!item.readAt) {
        await authenticatedRequest(`/v1/notifications/${item.id}/read`, { method: "PATCH" });
        const readAt = new Date().toISOString();
        const unreadTotal = Math.max(0, response.unread.all - 1);
        setResponse((current) => {
          const items = unreadOnly
            ? current.items.filter((entry) => entry.id !== item.id)
            : current.items.map((entry) => entry.id === item.id ? { ...entry, readAt } : entry);
          const total = unreadOnly ? Math.max(0, current.pagination.total - 1) : current.pagination.total;
          return {
            ...current,
            items,
            unread: {
              ...current.unread,
              all: Math.max(0, current.unread.all - 1),
              [item.category]: Math.max(0, current.unread[item.category] - 1),
            },
            pagination: {
              ...current.pagination,
              total,
              totalPages: total === 0 ? 0 : Math.ceil(total / current.pagination.pageSize),
            },
          };
        });
        if (selectionRequestRef.current === requestId) {
          setDetail((current) => current ? { ...current, readAt } : current);
          setAnnouncement("ทำเครื่องหมายว่าอ่านแล้ว");
        }
        window.dispatchEvent(new CustomEvent("fitconnect:notifications-changed", {
          detail: { unreadTotal },
        }));
      }
    } catch {
      if (selectionRequestRef.current === requestId) {
        setDetailError("เปิดรายละเอียดการแจ้งเตือนไม่สำเร็จ ลองอีกครั้ง");
      }
    } finally {
      if (selectionRequestRef.current === requestId) setDetailLoading(false);
    }
  }

  async function markAllRead() {
    setActionError(null);
    setMarkingAll(true);
    try {
      await authenticatedRequest<{ updated: number }>("/v1/notifications/read-all", { method: "POST" });
      const readAt = new Date().toISOString();
      setResponse((current) => ({
        ...current,
        items: unreadOnly ? [] : current.items.map((entry) => ({ ...entry, readAt: entry.readAt ?? readAt })),
        unread: { all: 0, booking: 0, payment: 0, appointment: 0 },
        pagination: unreadOnly
          ? { ...current.pagination, total: 0, totalPages: 0 }
          : current.pagination,
      }));
      setDetail((current) => current ? { ...current, readAt: current.readAt ?? readAt } : current);
      setAnnouncement("ทำเครื่องหมายว่าอ่านแล้วทั้งหมด");
      window.dispatchEvent(new CustomEvent("fitconnect:notifications-changed", {
        detail: { unreadTotal: 0 },
      }));
    } catch {
      const message = "ยังทำเครื่องหมายว่าอ่านแล้วทั้งหมดไม่ได้ ลองอีกครั้ง";
      setActionError(message);
      setAnnouncement(message);
    } finally {
      setMarkingAll(false);
    }
  }

  const filteredItems = response.items.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      item.title.toLowerCase().includes(q) ||
      item.message.toLowerCase().includes(q) ||
      item.bookingId.toLowerCase().includes(q)
    );
  });

  return (
    <section className="notification-center" data-detail-open={selectedId !== null}>
      <h1 className="sr-only">การแจ้งเตือน</h1>

      <p className="sr-only" aria-live="polite">{announcement}</p>

      {actionError && (
        <Alert variant="destructive" className="notification-center__action-error">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>อัปเดตรายการไม่สำเร็จ</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {loadState === "loading" && (
        <div className="notification-center__loading" role="status" aria-label="กำลังโหลดการแจ้งเตือน" aria-live="polite">
          <span className="sr-only">กำลังโหลดการแจ้งเตือน…</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {loadState === "error" && (
        <LoadError kind={loadError ?? "server"} onRetry={() => setReloadVersion((version) => version + 1)} />
      )}

      {loadState === "ready" && (
        <div className="notification-center__grid">
          <label className="notification-category-select">
            <span>หมวดการแจ้งเตือน</span>
            <NativeSelect
              aria-label="หมวดการแจ้งเตือน"
              value={category}
              onChange={(event) => updateCategory(event.target.value as NotificationCategory)}
            >
              {categories.map(({ key, label }) => (
                <NativeSelectOption key={key} value={key}>
                  {label}{response.unread[key] > 0 ? ` (${response.unread[key] > 99 ? "99+" : response.unread[key]})` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          <nav className="notification-categories" aria-label="หมวดการแจ้งเตือน">
            {categories.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                aria-label={categoryAccessibleLabel(label, response.unread[key])}
                aria-pressed={category === key}
                onClick={() => updateCategory(key)}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{label}</span>
                {response.unread[key] > 0 && <Badge>{response.unread[key] > 99 ? "99+" : response.unread[key]}</Badge>}
              </button>
            ))}
          </nav>

          <section className="notification-list-panel" aria-label="กล่องข้อความแจ้งเตือน" aria-busy={listRefreshing}>
            <div className="notification-list-panel__toolbar">
              <div className="toolbar-headline">
                <strong>{categories.find((entry) => entry.key === category)?.label}</strong>
                <span>{response.pagination.total} รายการ</span>
              </div>
              <div className="toolbar-controls">
                <div className="notification-search-box">
                  <Search aria-hidden="true" size={15} />
                  <input
                    type="search"
                    aria-label="ค้นหาการแจ้งเตือน"
                    placeholder="ค้นหารหัสการจอง หรือข้อความ..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="ทำเครื่องหมายว่าอ่านแล้วทั้งหมด"
                  disabled={response.unread.all === 0 || markingAll}
                  onClick={() => void markAllRead()}
                >
                  <CheckCheck aria-hidden="true" />
                  {markingAll ? "กำลังอัปเดต…" : "อ่านแล้วทั้งหมด"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={unreadOnly ? "secondary" : "outline"}
                  aria-pressed={unreadOnly}
                  onClick={updateUnreadFilter}
                >
                  เฉพาะที่ยังไม่ได้อ่าน
                </Button>
              </div>
            </div>

            {loadError && (
              <LoadError kind={loadError} onRetry={() => setReloadVersion((version) => version + 1)} />
            )}

            {listRefreshing ? (
              <div className="notification-list-loading" role="status" aria-label="กำลังโหลดรายการแจ้งเตือน" aria-live="polite">
                <span className="sr-only">กำลังโหลดรายการแจ้งเตือน…</span>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="notification-empty">
                <Bell aria-hidden="true" />
                <strong>{searchQuery ? "ไม่พบการแจ้งเตือนที่ตรงกับการค้นหา" : "ยังไม่มีการแจ้งเตือนในหมวดนี้"}</strong>
                <p>{searchQuery ? "ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง" : "เมื่อสถานะการจองหรือการชำระเงินเปลี่ยน รายการจะปรากฏที่นี่"}</p>
                {(category !== "all" || unreadOnly || searchQuery) && (
                  <Button type="button" variant="outline" onClick={resetFilters}>ดูทั้งหมด</Button>
                )}
              </div>
            ) : (
              <ul className="notification-list" aria-label="รายการแจ้งเตือน">
                {filteredItems.slice(0, 10).map((item) => {
                  const Icon = getCategoryIcon(item.category);
                  const urgent = isUrgentNotification(item);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-read={item.readAt ? "true" : "false"}
                        data-urgent={urgent ? "true" : undefined}
                        aria-current={selectedId === item.id ? "true" : undefined}
                        aria-label={`${item.title} ${item.readAt ? "อ่านแล้ว" : "ยังไม่ได้อ่าน"}`}
                        onClick={() => void openNotification(item)}
                      >
                        <div className={`notification-item-icon notification-item-icon--${item.category}`} aria-hidden="true">
                          <Icon size={16} />
                        </div>
                        <span className="notification-list__copy">
                          <span className="notification-list__meta">
                            <span className="notification-list__badges">
                              <Badge variant="outline" className={`category-badge category-badge--${item.category}`}>
                                {categoryLabel(item.category)}
                              </Badge>
                              {urgent && <span className="urgency-badge">⚠️ ต้องดำเนินการ</span>}
                            </span>
                            <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                              {formatRelativeTime(item.createdAt)}
                            </time>
                          </span>
                          <strong>{item.title}</strong>
                          <small>{item.message}</small>
                          <code>{item.bookingId}</code>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {response.pagination.totalPages > 1 && (
              <nav className="notification-pagination" aria-label="หน้ารายการแจ้งเตือน">
                <Button type="button" variant="outline" size="icon" aria-label="หน้าก่อนหน้า" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span>หน้า {page + 1} จาก {response.pagination.totalPages}</span>
                <Button type="button" variant="outline" size="icon" aria-label="หน้าถัดไป" disabled={page + 1 >= response.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
                  <ChevronRight aria-hidden="true" />
                </Button>
              </nav>
            )}
          </section>

          <section className="notification-detail-panel" aria-label="รายละเอียดการแจ้งเตือน">
            {selectedId !== null && (
              <Button className="notification-detail-panel__back" type="button" variant="ghost" onClick={() => {
                selectionRequestRef.current += 1;
                setSelectedId(null);
                setDetail(null);
                setDetailError(null);
              }}>
                <ArrowLeft aria-hidden="true" /> กลับรายการแจ้งเตือน
              </Button>
            )}

            {detailLoading && (
              <div className="notification-detail-loading" role="status" aria-live="polite">
                <span className="sr-only">กำลังโหลดรายละเอียด…</span>
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}

            {detailError && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertTitle>เปิดรายละเอียดไม่สำเร็จ</AlertTitle>
                <AlertDescription>{detailError}</AlertDescription>
                <Button type="button" variant="outline" onClick={() => {
                  const selectedItem = response.items.find((item) => item.id === selectedId);
                  if (selectedItem) void openNotification(selectedItem);
                }}>ลองเปิดรายละเอียดอีกครั้ง</Button>
              </Alert>
            )}

            {!detailLoading && !detailError && !detail && (
              <div className="notification-detail-placeholder">
                <div className="notification-placeholder-icon">
                  <Bell aria-hidden="true" size={36} />
                </div>
                <strong>เลือกรายการเพื่อดูรายละเอียด</strong>
                <p>ข้อมูลการจอง สถานะการชำระเงิน และขั้นตอนถัดไปจะแสดงในพื้นที่นี้</p>
                <div className="notification-placeholder-tips">
                  <div className="placeholder-tip">
                    <CreditCard size={16} aria-hidden="true" />
                    <span>ตรวจสอบสถานะสลิปและยอดชำระเงิน</span>
                  </div>
                  <div className="placeholder-tip">
                    <CalendarCheck size={16} aria-hidden="true" />
                    <span>ติดตามนัดหมายและตารางเวลากับเทรนเนอร์</span>
                  </div>
                </div>
              </div>
            )}

            {!detailLoading && detail && (
              <article className="notification-detail" key={detail.id}>
                <header>
                  <div className="notification-detail__meta">
                    <Badge variant="outline" className={`category-badge category-badge--${detail.category}`}>
                      {categoryLabel(detail.category)}
                    </Badge>
                    {isUrgentNotification(detail) && <span className="urgency-badge">⚠️ ต้องดำเนินการ</span>}
                    <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time>
                  </div>
                  <h2>{detail.title}</h2>
                  <p>{detail.message}</p>
                </header>

                <dl className="notification-booking-facts">
                  <div><dt>รหัสการจอง</dt><dd>{detail.booking.id}</dd></div>
                  <div><dt>สมาชิก</dt><dd>{detail.booking.memberName}</dd></div>
                  <div><dt>เทรนเนอร์</dt><dd>{detail.booking.trainerName}</dd></div>
                  <div><dt>วันและเวลา</dt><dd>{formatDateTime(detail.booking.startsAt)}–{formatDateTime(detail.booking.endsAt)}</dd></div>
                  <div><dt>สถานะการจอง</dt><dd><StatusBadge status={detail.booking.status} /></dd></div>
                  <div><dt>การชำระเงิน</dt><dd><PaymentStatusBadge status={detail.booking.paymentStatus} /></dd></div>
                  <div><dt>ยอดชำระ</dt><dd>{detail.booking.quotedPrice === null ? "—" : new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(detail.booking.quotedPrice)}</dd></div>
                </dl>

                {detail.booking.history.length > 0 && (
                  <details className="notification-history">
                    <summary>ดูประวัติสถานะ {detail.booking.history.length} รายการ</summary>
                    <ol>
                      {detail.booking.history.map((entry, index) => (
                        <li key={`${entry.createdAt}-${index}`}>
                          <span>{bookingStatus[entry.toStatus] ?? entry.toStatus}</span>
                          <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                          {entry.note && <small>{entry.note}</small>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {safeInternalPath(detail.actionPath) && (
                  <Button className="button--accent button--wide notification-cta-btn" asChild>
                    <Link href={safeInternalPath(detail.actionPath) ?? "/"}>{actionLabel(detail)}</Link>
                  </Button>
                )}
              </article>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
