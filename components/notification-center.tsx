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
  CalendarClock,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CreditCard,
} from "lucide-react";
import { authenticatedRequest } from "@/lib/api";
import type {
  NotificationCategory,
  NotificationDetail,
  NotificationItem,
  NotificationListResponse,
} from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type LoadState = "loading" | "ready" | "error";

const categories: Array<{ key: NotificationCategory; label: string; icon: typeof Bell }> = [
  { key: "all", label: "ทั้งหมด", icon: Bell },
  { key: "booking", label: "การจอง", icon: CalendarClock },
  { key: "payment", label: "การชำระเงิน", icon: CreditCard },
  { key: "appointment", label: "นัดหมาย", icon: CalendarClock },
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

const paymentStatus: Record<string, string> = {
  not_submitted: "ยังไม่ส่งหลักฐาน",
  reviewing: "กำลังตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ต้องส่งใหม่",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
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

export function NotificationCenter() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [response, setResponse] = useState<NotificationListResponse>(emptyResponse);
  const [category, setCategory] = useState<NotificationCategory>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NotificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const selectionRequestRef = useRef(0);

  const loadNotifications = useCallback(async () => {
    setLoadState("loading");
    try {
      const nextResponse = await authenticatedRequest<NotificationListResponse>(
        `/v1/notifications?page=${page}&category=${category}&unread=${unreadOnly}`,
      );
      setResponse(nextResponse);
      setLoadState("ready");
    } catch {
      setLoadState("error");
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
  }

  function updateUnreadFilter() {
    selectionRequestRef.current += 1;
    setUnreadOnly((current) => !current);
    setPage(0);
    setSelectedId(null);
    setDetail(null);
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
      setAnnouncement("ยังทำเครื่องหมายว่าอ่านแล้วทั้งหมดไม่ได้ ลองอีกครั้ง");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <section className="notification-center" data-detail-open={selectedId !== null}>
      <div className="notification-center__actions">
        <Button
          type="button"
          variant="outline"
          disabled={response.unread.all === 0 || markingAll}
          onClick={() => void markAllRead()}
        >
          <CheckCheck aria-hidden="true" />
          {markingAll ? "กำลังอัปเดต…" : "ทำเครื่องหมายว่าอ่านแล้วทั้งหมด"}
        </Button>
      </div>

      <p className="sr-only" aria-live="polite">{announcement}</p>

      {loadState === "loading" && (
        <div className="notification-center__loading" role="status" aria-label="กำลังโหลดการแจ้งเตือน" aria-live="polite">
          <span className="sr-only">กำลังโหลดการแจ้งเตือน…</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {loadState === "error" && (
        <Alert variant="destructive" className="notification-center__error">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>โหลดการแจ้งเตือนไม่สำเร็จ</AlertTitle>
          <AlertDescription>ตรวจว่า Apache และ MySQL ทำงานอยู่ แล้วลองโหลดรายการอีกครั้ง</AlertDescription>
          <Button type="button" variant="outline" onClick={() => setReloadVersion((version) => version + 1)}>ลองใหม่</Button>
        </Alert>
      )}

      {loadState === "ready" && (
        <div className="notification-center__grid">
          <nav className="notification-categories" aria-label="หมวดการแจ้งเตือน">
            {categories.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                aria-label={label}
                aria-pressed={category === key}
                onClick={() => updateCategory(key)}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{label}</span>
                {response.unread[key] > 0 && <Badge>{response.unread[key] > 99 ? "99+" : response.unread[key]}</Badge>}
              </button>
            ))}
          </nav>

          <section className="notification-list-panel" aria-label="กล่องข้อความแจ้งเตือน">
            <div className="notification-list-panel__toolbar">
              <div>
                <strong>{categories.find((entry) => entry.key === category)?.label}</strong>
                <span>{response.pagination.total} รายการ</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant={unreadOnly ? "secondary" : "outline"}
                aria-pressed={unreadOnly}
                onClick={updateUnreadFilter}
              >เฉพาะที่ยังไม่ได้อ่าน</Button>
            </div>

            {response.items.length === 0 ? (
              <div className="notification-empty">
                <Bell aria-hidden="true" />
                <strong>ยังไม่มีการแจ้งเตือนในหมวดนี้</strong>
                <p>เมื่อสถานะการจองหรือการชำระเงินเปลี่ยน รายการจะปรากฏที่นี่</p>
                <Button type="button" variant="outline" onClick={() => updateCategory("all")}>ดูทั้งหมด</Button>
              </div>
            ) : (
              <ul className="notification-list" aria-label="รายการแจ้งเตือน">
                {response.items.slice(0, 10).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-read={item.readAt ? "true" : "false"}
                      aria-current={selectedId === item.id ? "true" : undefined}
                      aria-label={`${item.title} ${item.readAt ? "อ่านแล้ว" : "ยังไม่ได้อ่าน"}`}
                      onClick={() => void openNotification(item)}
                    >
                      <span className="notification-list__marker" aria-hidden="true" />
                      <span className="notification-list__copy">
                        <span><Badge variant="outline">{categoryLabel(item.category)}</Badge><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time></span>
                        <strong>{item.title}</strong>
                        <small>{item.message}</small>
                        <code>{item.bookingId}</code>
                      </span>
                    </button>
                  </li>
                ))}
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
              </Alert>
            )}

            {!detailLoading && !detailError && !detail && (
              <div className="notification-detail-placeholder">
                <Bell aria-hidden="true" />
                <strong>เลือกรายการเพื่อดูรายละเอียด</strong>
                <p>ข้อมูลการจองและขั้นตอนถัดไปจะแสดงในพื้นที่นี้</p>
              </div>
            )}

            {!detailLoading && detail && (
              <article className="notification-detail" key={detail.id}>
                <header>
                  <Badge variant="outline">{categoryLabel(detail.category)}</Badge>
                  <time dateTime={detail.createdAt}>{formatDateTime(detail.createdAt)}</time>
                  <h2>{detail.title}</h2>
                  <p>{detail.message}</p>
                </header>

                <dl className="notification-booking-facts">
                  <div><dt>รหัสการจอง</dt><dd>{detail.booking.id}</dd></div>
                  <div><dt>สมาชิก</dt><dd>{detail.booking.memberName}</dd></div>
                  <div><dt>เทรนเนอร์</dt><dd>{detail.booking.trainerName}</dd></div>
                  <div><dt>วันและเวลา</dt><dd>{formatDateTime(detail.booking.startsAt)}–{formatDateTime(detail.booking.endsAt)}</dd></div>
                  <div><dt>สถานะการจอง</dt><dd>{bookingStatus[detail.booking.status] ?? detail.booking.status}</dd></div>
                  <div><dt>การชำระเงิน</dt><dd>{paymentStatus[detail.booking.paymentStatus] ?? detail.booking.paymentStatus}</dd></div>
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
                  <Button asChild>
                    <Link href={safeInternalPath(detail.actionPath) ?? "/"}>เปิดรายการที่เกี่ยวข้อง</Link>
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
