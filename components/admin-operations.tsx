"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, BookOpen, CalendarCheck2, ChartColumn, Dumbbell, UserRound, Wallet, ChevronLeft, ChevronRight, CircleDollarSign, Download, RefreshCw, ShieldCheck, Trash2, UserCog, UsersRound } from "lucide-react";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { PaymentRoutingSettings } from "@/components/payment-routing-settings";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authenticatedRequest } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { bookingStatusCopy, bookingStatusLabel, paymentStatusLabel } from "@/lib/payment-copy";
import { leaveExpiredSession } from "@/lib/session";
import type { AdminOperationsData, AdminPermissions } from "@/lib/types";

type AdminTab = "review" | "users" | "bookings" | "finance" | "reports" | "administrators" | "account";
const pageSize = 10;

/**
 * `GET /v1/admin/reports` shapes land in `lib/types.ts` with the backend change;
 * every section is optional because the endpoint returns only what the admin's
 * permissions allow. `month` is read as 1–12 or "YYYY-MM".
 */
export type AdminReportBookingsMonth = { month: number | string; total: number; byStatus: Record<string, number> };
export type AdminReportIncomeMonth = { month: number | string; amount: number };
export type AdminReportPaymentsMonth = { month: number | string; submitted: number; approved: number; rejected: number };
export type AdminReportUserCount = { role: string; count: number };
export type AdminReportsPayload = {
  year?: number;
  bookingsByMonth?: AdminReportBookingsMonth[];
  incomeByMonth?: AdminReportIncomeMonth[];
  paymentsByMonth?: AdminReportPaymentsMonth[];
  usersByRole?: AdminReportUserCount[];
  totals?: Record<string, number>;
};

/** `gymSalaries` arrives on `GET /v1/admin/operations` alongside the lists. */
export type GymSalaryRow = { trainerId: number; trainerName: string; month: string; sessions: number; amount: number };

const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function monthNumber(value: number | string): number {
  if (typeof value === "number") return value >= 1 && value <= 12 ? value : 0;
  const tail = value.includes("-") ? value.split("-").pop() : value;
  const parsed = Number(tail);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : 0;
}

function monthLabel(value: number | string): string {
  const month = monthNumber(value);
  if (month === 0) return String(value);
  const yearPart = typeof value === "string" && value.includes("-") ? Number(value.split("-")[0]) : NaN;
  return Number.isInteger(yearPart) ? `${thaiMonths[month - 1]} ${yearPart + 543}` : thaiMonths[month - 1];
}

/** Columns follow the canonical status order, so a status added to `bookingStatusCopy` cannot go missing from the report. */
const reportStatusOrder: readonly string[] = Object.keys(bookingStatusCopy);
const reportUserRoleLabels: Record<string, string> = { member: "สมาชิก", trainer: "เทรนเนอร์", admin: "ผู้ดูแลระบบ" };

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvEscape).join(",");
}

/**
 * One CSV document for everything the admin can see: each returned section gets
 * a Thai-headed block. The BOM is part of the content so Excel reads Thai
 * without an import wizard.
 */
export function buildReportsCsv(reports: AdminReportsPayload): string {
  const lines: string[] = ["\uFEFF"];
  const bookings = [...(reports.bookingsByMonth ?? [])].sort((a, b) => monthNumber(a.month) - monthNumber(b.month));
  if (reports.bookingsByMonth) {
    const statusKeys = reportStatusOrder.filter((status) => bookings.some((row) => (row.byStatus?.[status] ?? 0) !== 0));
    lines.push(csvRow(["การจองแยกตามสถานะ"]));
    lines.push(csvRow(["เดือน", ...statusKeys.map((status) => bookingStatusLabel(status)), "รวม"]));
    for (const row of bookings) {
      lines.push(csvRow([monthLabel(row.month), ...statusKeys.map((status) => row.byStatus?.[status] ?? 0), row.total ?? 0]));
    }
    lines.push("");
  }
  const income = [...(reports.incomeByMonth ?? [])].sort((a, b) => monthNumber(a.month) - monthNumber(b.month));
  if (reports.incomeByMonth) {
    lines.push(csvRow(["รายได้ที่อนุมัติแล้ว"]));
    lines.push(csvRow(["เดือน", "จำนวนเงิน (บาท)"]));
    for (const row of income) lines.push(csvRow([monthLabel(row.month), row.amount ?? 0]));
    lines.push("");
  }
  const payments = [...(reports.paymentsByMonth ?? [])].sort((a, b) => monthNumber(a.month) - monthNumber(b.month));
  if (reports.paymentsByMonth) {
    lines.push(csvRow(["การชำระเงิน"]));
    lines.push(csvRow(["เดือน", "ส่งตรวจ", "อนุมัติ", "ปฏิเสธ"]));
    for (const row of payments) lines.push(csvRow([monthLabel(row.month), row.submitted ?? 0, row.approved ?? 0, row.rejected ?? 0]));
    lines.push("");
  }
  if (reports.usersByRole) {
    lines.push(csvRow(["ผู้ใช้แยกตามประเภท"]));
    lines.push(csvRow(["ประเภทผู้ใช้", "จำนวน (คน)"]));
    for (const row of reports.usersByRole) {
      lines.push(csvRow([reportUserRoleLabels[row.role] ?? row.role, row.count]));
    }
  }
  return lines.join("\r\n");
}

const emptyPermissions: AdminPermissions = {
  manageUsers: false,
  reviewTrainers: false,
  manageBookings: false,
  reviewPayments: false,
};

const permissionLabels: Array<[keyof AdminPermissions, string]> = [
  ["manageUsers", "จัดการบัญชีผู้ใช้และผู้ดูแลระบบ"],
  ["reviewTrainers", "ตรวจใบสมัครและใบรับรองเทรนเนอร์"],
  ["manageBookings", "ตรวจสอบและจัดการสถานะการจอง"],
  ["reviewPayments", "ตรวจการชำระเงินและรายได้"],
];

const roleCopy = { member: "สมาชิก", trainer: "เทรนเนอร์", admin: "ผู้ดูแลระบบ" } as const;

function formatMoney(value: number | null) {
  return value === null ? "ไม่ระบุ" : new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);
}

function AccountStatus({ status }: { status: "active" | "suspended" | "deleted" }) {
  return <span className={`status-badge status-badge--${status === "active" ? "success" : "error"}`}>{status === "active" ? "ใช้งานอยู่" : status === "suspended" ? "ระงับบัญชี" : "ลบบัญชีแล้ว"}</span>;
}

function Pager({ label, page, total, onChange }: { label: string; page: number; total: number; onChange: (page: number) => void }) {
  if (total === 0) return null;
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount === 1) return null;
  return (
    <nav className="admin-pager" aria-label={`แบ่งหน้า${label}`}>
      <span>{label} {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} จาก {total}</span>
      <div>
        <Button type="button" variant="outline" disabled={page === 0} aria-label={`หน้า${label}ก่อนหน้า`} onClick={() => onChange(page - 1)}><ChevronLeft aria-hidden="true" /></Button>
        <strong>หน้า {page + 1} / {pageCount}</strong>
        <Button type="button" variant="outline" disabled={page + 1 >= pageCount} aria-label={`หน้า${label}ถัดไป`} onClick={() => onChange(page + 1)}><ChevronRight aria-hidden="true" /></Button>
      </div>
    </nav>
  );
}

function PermissionFields({ value, allowed = { manageUsers: true, reviewTrainers: true, manageBookings: true, reviewPayments: true }, disabled = false, onChange }: {
  value: AdminPermissions;
  allowed?: AdminPermissions;
  disabled?: boolean;
  onChange: (value: AdminPermissions) => void;
}) {
  return (
    <fieldset className="admin-permission-grid" disabled={disabled}>
      <legend>ขอบเขตการเข้าถึง</legend>
      {permissionLabels.map(([key, label]) => (
        <label key={key}>
          <input type="checkbox" checked={value[key]} disabled={disabled || !allowed[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

type ManagedUser = AdminOperationsData["users"][number] | AdminOperationsData["administrators"][number];
type ManagedBooking = AdminOperationsData["bookings"][number];

function AdministratorEditor({ user, currentUserId, assignablePermissions, busy, onSave, onToggle, onDelete }: {
  user: AdminOperationsData["administrators"][number];
  currentUserId: number;
  assignablePermissions: AdminPermissions;
  busy: boolean;
  onSave: (id: number, input: { displayName: string; email: string; permissions?: AdminPermissions }) => Promise<void>;
  onToggle: (user: ManagedUser) => void;
  onDelete: (user: ManagedUser) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [permissions, setPermissions] = useState(user.permissions ?? emptyPermissions);
  const isSelf = user.id === currentUserId;
  const hasPermission = Object.values(permissions).some(Boolean);
  return (
    <details className="admin-record-disclosure">
      <summary><span><strong>{user.displayName}</strong><small>{user.email}</small></span><AccountStatus status={user.status} /></summary>
      <form className="admin-editor" onSubmit={(event) => { event.preventDefault(); void onSave(user.id, { displayName, email, ...(isSelf ? {} : { permissions }) }); }}>
        <div className="admin-editor__fields">
          <label><span>ชื่อที่แสดง</span><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label><span>อีเมล</span><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        </div>
        <PermissionFields value={permissions} allowed={assignablePermissions} disabled={isSelf} onChange={setPermissions} />
        {!isSelf && !hasPermission && <p className="row-error" role="alert">เลือกสิทธิ์อย่างน้อย 1 รายการ</p>}
        {isSelf && <p className="admin-inline-note">บัญชีที่กำลังใช้งานแก้สิทธิ์หรือตั้งเป็นระงับไม่ได้</p>}
        {!isSelf && Object.values(assignablePermissions).some((allowed) => !allowed) && <p className="admin-inline-note">สิทธิ์ที่บัญชีของคุณไม่มีจะดูได้อย่างเดียวและแก้ไขไม่ได้</p>}
        <div className="admin-row-actions">
          <Button type="submit" disabled={busy || (!isSelf && !hasPermission)}>บันทึกบัญชีผู้ดูแลระบบ</Button>
          {!isSelf && user.status !== "deleted" && <Button type="button" variant={user.status === "active" ? "destructive" : "outline"} disabled={busy} onClick={() => onToggle(user)}>{user.status === "active" ? "ระงับบัญชี" : "เปิดใช้งานบัญชี"}</Button>}
          {user.status !== "deleted" && <Button type="button" variant="destructive" disabled={busy} aria-label={`ลบบัญชี ${user.displayName}`} onClick={() => onDelete(user)}><Trash2 aria-hidden="true" /> ลบบัญชี</Button>}
        </div>
      </form>
    </details>
  );
}

function AdministratorPasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmation) { setMessage("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"); return; }
    setBusy(true); setMessage("");
    try {
      await authenticatedRequest("/v1/profile/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setMessage("เปลี่ยนรหัสผ่านแล้ว");
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  return (
    <details className="admin-record-disclosure admin-password-disclosure">
      <summary><span><strong>รหัสผ่านของบัญชีนี้</strong><small>เปลี่ยนรหัสผ่านเริ่มต้นหลังเข้าสู่ระบบครั้งแรก</small></span></summary>
      <form className="admin-editor" aria-label="เปลี่ยนรหัสผ่านผู้ดูแลระบบ" onSubmit={submit}>
        <div className="admin-editor__fields">
          <label><span>รหัสผ่านปัจจุบัน</span><Input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label><span>รหัสผ่านใหม่ อย่างน้อย 8 ตัวอักษร</span><Input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label><span>ยืนยันรหัสผ่านใหม่</span><Input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        </div>
        {message && <p className={message === "เปลี่ยนรหัสผ่านแล้ว" ? "queue-notice" : "row-error"} role="status">{message}</p>}
        <Button type="submit" disabled={busy}>{busy ? "กำลังเปลี่ยน…" : "เปลี่ยนรหัสผ่าน"}</Button>
      </form>
    </details>
  );
}

function UserEditor({ user, busy, onSave, onToggle, onDelete }: {
  user: AdminOperationsData["users"][number];
  busy: boolean;
  onSave: (id: number, input: { displayName: string; email: string }) => Promise<void>;
  onToggle: (user: ManagedUser) => void;
  onDelete: (user: ManagedUser) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  return (
    <details className="admin-record-disclosure admin-user-editor">
      <summary>
        <span><strong>{user.displayName}</strong><small>{user.email} · {roleCopy[user.role]}</small></span>
        <span className="admin-account-row__status"><AccountStatus status={user.status} />{user.approvalStatus && <StatusBadge status={user.approvalStatus} source="approval" />}</span>
      </summary>
      <form className="admin-editor" onSubmit={(event) => { event.preventDefault(); void onSave(user.id, { displayName, email }); }}>
        <div className="admin-editor__fields">
          <label><span>ชื่อที่แสดง</span><Input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label><span>อีเมล</span><Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        </div>
        <p className="admin-inline-note">สมัครเมื่อ {formatDateTime(user.createdAt)}</p>
        <div className="admin-row-actions">
          <Button type="submit" disabled={busy}>บันทึกข้อมูลบัญชี</Button>
          {user.status !== "deleted" && <Button type="button" variant={user.status === "active" ? "destructive" : "outline"} disabled={busy} aria-label={`${user.status === "active" ? "ระงับ" : "เปิดใช้งาน"}บัญชี ${user.displayName}`} onClick={() => onToggle(user)}>
            {user.status === "active" ? <><Ban aria-hidden="true" /> ระงับบัญชี</> : "เปิดใช้งานบัญชี"}
          </Button>}
          {user.status !== "deleted" && <Button type="button" variant="destructive" disabled={busy} aria-label={`ลบบัญชี ${user.displayName}`} onClick={() => onDelete(user)}>
            <Trash2 aria-hidden="true" /> ลบบัญชี
          </Button>}
        </div>
      </form>
    </details>
  );
}

export function AdminOperations() {
  const router = useRouter();
  const navigate = router.push;
  const [data, setData] = useState<AdminOperationsData | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("review");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [bookingStatus, setBookingStatus] = useState("all");
  const [userPage, setUserPage] = useState(0);
  const [bookingPage, setBookingPage] = useState(0);
  const [incomePage, setIncomePage] = useState(0);
  const [paymentPage, setPaymentPage] = useState(0);
  const [administratorPage, setAdministratorPage] = useState(0);
  const [newAdmin, setNewAdmin] = useState({ displayName: "", email: "", password: "", permissions: emptyPermissions });
  const [accountAction, setAccountAction] = useState<{ user: ManagedUser; status: "active" | "suspended" } | null>(null);
  const [userToDelete, setUserToDelete] = useState<ManagedUser | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [reports, setReports] = useState<AdminReportsPayload | null>(null);
  const [reportsYear, setReportsYear] = useState(() => new Date().getFullYear());
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [bookingToCancel, setBookingToCancel] = useState<ManagedBooking | null>(null);
  const [cancelReason, setCancelReason] = useState("ผู้ดูแลระบบยกเลิกรายการ");

  const loadOperations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        userPage: String(userPage),
        userQuery: query,
        administratorPage: String(administratorPage),
        bookingPage: String(bookingPage),
        bookingStatus,
        incomePage: String(incomePage),
        paymentPage: String(paymentPage),
      });
      const response = await authenticatedRequest<AdminOperationsData>(`/v1/admin/operations?${params.toString()}`);
      setData(response);
      setError("");
      const canReview = response.permissions.reviewTrainers || response.permissions.reviewPayments;
      if (!canReview) setActiveTab((current) => current === "review" ? (response.permissions.manageUsers ? "users" : response.permissions.manageBookings ? "bookings" : "finance") : current);
    } catch (requestError) {
      if (leaveExpiredSession(requestError, navigate)) return;
      setError(requestError instanceof Error ? requestError.message : "โหลดข้อมูลผู้ดูแลระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [administratorPage, bookingPage, bookingStatus, incomePage, navigate, paymentPage, query, userPage]);

  useEffect(() => {
    const request = window.setTimeout(() => { void loadOperations(); }, query ? 200 : 0);
    return () => window.clearTimeout(request);
  }, [loadOperations, query]);

  useEffect(() => {
    if (activeTab !== "reports") return;
    let active = true;
    void (async () => {
      setReportsLoading(true);
      setReportsError("");
      try {
        const payload = await authenticatedRequest<AdminReportsPayload>(`/v1/admin/reports?year=${reportsYear}`);
        if (!active) return;
        setReports(payload ?? null);
        if (!payload) setReportsError("รูปแบบข้อมูลรายงานไม่ถูกต้อง");
      } catch (requestError) {
        if (!active) return;
        setReports(null);
        if (leaveExpiredSession(requestError, navigate)) return;
        setReportsError(requestError instanceof Error ? requestError.message : "โหลดรายงานไม่สำเร็จ");
      } finally {
        if (active) setReportsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [activeTab, navigate, reportsYear]);

  const tabs = useMemo(() => {
    if (!data) return [];
    const result: Array<{ id: AdminTab; label: string; icon: typeof ShieldCheck }> = [];
    if (data.permissions.reviewTrainers || data.permissions.reviewPayments) result.push({ id: "review", label: "อนุมัติเทรนเนอร์", icon: ShieldCheck });
    if (data.permissions.manageUsers) result.push({ id: "users", label: "สมาชิกและเทรนเนอร์", icon: UsersRound });
    if (data.permissions.manageBookings) result.push({ id: "bookings", label: "การจอง", icon: BookOpen });
    if (data.permissions.reviewPayments) result.push({ id: "finance", label: "การชำระเงิน", icon: CircleDollarSign });
    if (data.permissions.manageBookings || data.permissions.reviewPayments) result.push({ id: "reports", label: "รายงาน", icon: ChartColumn });
    if (data.permissions.manageUsers) result.push({ id: "administrators", label: "ผู้ดูแลระบบ", icon: UserCog });
    result.push({ id: "account", label: "บัญชีของฉัน", icon: UserCog });
    return result;
  }, [data]);

  const visibleUsers = data?.users ?? [];
  const visibleBookings = data?.bookings ?? [];
  const visibleIncome = data?.trainerIncome ?? [];
  const visiblePayments = data?.payments ?? [];
  const canCreateAdministrator = Object.values(newAdmin.permissions).some(Boolean);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(`admin-tab-${nextTab.id}`)?.focus());
  }

  async function updateUser(user: ManagedUser, status: "active" | "suspended") {
    const action = status === "suspended" ? "ระงับ" : "เปิดใช้งาน";
    setBusy(`user-${user.id}`); setError(""); setNotice("");
    try {
      await authenticatedRequest(`/v1/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadOperations();
      setNotice(`${action}บัญชี “${user.displayName}” แล้ว`);
      setAccountAction(null);
    } catch (requestError) {
      if (leaveExpiredSession(requestError, navigate)) return;
      setError(requestError instanceof Error ? requestError.message : `${action}บัญชีไม่สำเร็จ`);
    } finally { setBusy(null); }
  }

  async function saveAccount(id: number, input: { displayName: string; email: string; permissions?: AdminPermissions }) {
    setBusy(`user-${id}`); setError(""); setNotice("");
    try {
      await authenticatedRequest(`/v1/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(input) });
      await loadOperations();
      setNotice("บันทึกข้อมูลบัญชีแล้ว");
    } catch (requestError) {
      if (leaveExpiredSession(requestError, navigate)) return;
      setError(requestError instanceof Error ? requestError.message : "บันทึกข้อมูลบัญชีไม่สำเร็จ");
    } finally { setBusy(null); }
  }

  async function createAdministrator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("create-admin"); setError(""); setNotice("");
    try {
      await authenticatedRequest("/v1/admin/users", { method: "POST", body: JSON.stringify(newAdmin) });
      setNewAdmin({ displayName: "", email: "", password: "", permissions: emptyPermissions });
      await loadOperations();
      setNotice("เพิ่มผู้ดูแลระบบแล้ว");
    } catch (requestError) {
      if (leaveExpiredSession(requestError, navigate)) return;
      setError(requestError instanceof Error ? requestError.message : "เพิ่มผู้ดูแลระบบไม่สำเร็จ");
    } finally { setBusy(null); }
  }

  async function cancelBookingByAdmin() {
    if (!bookingToCancel || !cancelReason.trim()) return;
    const id = bookingToCancel.id;
    setBusy(`cancel-${id}`); setError(""); setNotice("");
    try {
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled", note: cancelReason.trim() }),
      });
      await loadOperations();
      setNotice(`ยกเลิกการจอง ${id} และคืนสล็อตสู่ระบบแล้ว`);
      setBookingToCancel(null);
    } catch (requestError) {
      if (leaveExpiredSession(requestError, navigate)) return;
      setError(requestError instanceof Error ? requestError.message : "ยกเลิกการจองไม่สำเร็จ");
    } finally { setBusy(null); }
  }

  async function deleteUser() {
    if (!userToDelete) return;
    const target = userToDelete;
    setBusy(`user-${target.id}`); setError(""); setNotice(""); setDeleteError("");
    try {
      await authenticatedRequest(`/v1/admin/users/${target.id}`, { method: "DELETE" });
      await loadOperations();
      setNotice(`ลบบัญชี “${target.displayName}” ออกจากระบบแล้ว`);
      setUserToDelete(null);
    } catch (requestError) {
      if (leaveExpiredSession(requestError, navigate)) return;
      // The 409 guards (SELF_DELETION, LAST_USER_MANAGER) come back as Thai
      // messages; they are shown in the dialog so the reason stays with the row.
      setDeleteError(requestError instanceof Error ? requestError.message : "ลบบัญชีไม่สำเร็จ");
    } finally { setBusy(null); }
  }

  function downloadReportsCsv() {
    if (!reports) return;
    const blob = new Blob([buildReportsCsv(reports)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    if (typeof URL.createObjectURL === "function") {
      link.href = URL.createObjectURL(blob);
      window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    } else {
      link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(buildReportsCsv(reports))}`;
    }
    link.download = `fitconnect-reports-${reportsYear}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setNotice("ดาวน์โหลดไฟล์ CSV แล้ว");
  }

  if (loading && !data) return <section className="queue-loading" aria-live="polite">กำลังโหลดพื้นที่ผู้ดูแลระบบ…</section>;
  if (error && !data) return <section className="queue-retry" role="alert"><strong>ยังเปิดพื้นที่ผู้ดูแลระบบไม่ได้</strong><p>{error}</p><Button onClick={() => void loadOperations()}><RefreshCw aria-hidden="true" /> ลองใหม่</Button></section>;
  if (!data) return null;

  const gymSalaries = (data as AdminOperationsData & { gymSalaries?: GymSalaryRow[] }).gymSalaries ?? null;
  const reportBookings = reports?.bookingsByMonth ? [...reports.bookingsByMonth].sort((a, b) => monthNumber(a.month) - monthNumber(b.month)) : null;
  const reportStatusColumns = reportStatusOrder.filter((status) => reportBookings?.some((row) => (row.byStatus?.[status] ?? 0) !== 0));
  const reportIncome = reports?.incomeByMonth ? [...reports.incomeByMonth].sort((a, b) => monthNumber(a.month) - monthNumber(b.month)) : null;
  const reportPayments = reports?.paymentsByMonth ? [...reports.paymentsByMonth].sort((a, b) => monthNumber(a.month) - monthNumber(b.month)) : null;
  const reportUsers = reports?.usersByRole ?? null;
  const hasReportSection = Boolean(reportBookings || reportIncome || reportPayments || reportUsers);

  return (
    <div className="admin-operations" aria-busy={loading}>
      <section className="admin-operations__summary" aria-label="ภาพรวมระบบ">
        {data.summary.activeMembers !== null && <div><i aria-hidden="true"><UserRound size={18} /></i><span>สมาชิกที่ใช้งาน</span><strong>{data.summary.activeMembers}</strong></div>}
        {data.summary.activeTrainers !== null && <div><i aria-hidden="true"><Dumbbell size={18} /></i><span>เทรนเนอร์ที่ใช้งาน</span><strong>{data.summary.activeTrainers}</strong></div>}
        {data.summary.totalBookings !== null && <div><i aria-hidden="true"><CalendarCheck2 size={18} /></i><span>การจองทั้งหมด</span><strong>{data.summary.totalBookings}</strong></div>}
        {data.summary.approvedRevenue !== null && <div><i aria-hidden="true"><Wallet size={18} /></i><span>ยอดที่เทรนเนอร์ยืนยันสลิปแล้ว</span><strong>{formatMoney(data.summary.approvedRevenue)}</strong></div>}
      </section>

      <div className="admin-operations__tabs" role="tablist" aria-label="งานผู้ดูแลระบบ">
        {tabs.map(({ id, label, icon: Icon }, index) => <button key={id} id={`admin-tab-${id}`} type="button" role="tab" tabIndex={activeTab === id ? 0 : -1} aria-selected={activeTab === id} aria-controls="admin-workspace-panel" onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => setActiveTab(id)}><Icon aria-hidden="true" />{label}</button>)}
      </div>
      {notice && <p className="queue-notice" role="status">{notice}</p>}
      {error && <p className="row-error" role="alert">{error}</p>}

      <section id="admin-workspace-panel" role="tabpanel" aria-labelledby={`admin-tab-${activeTab}`}>
        {activeTab === "review" && <AdminReviewQueue />}
        {activeTab === "users" && (
          <div className="admin-operation-panel">
            <header>
              <div><h2>จัดการข้อมูล สมาชิก เทรนเนอร์</h2><p>กดชื่อบัญชีเมื่อต้องการแก้ข้อมูลหรือระงับการใช้งาน</p></div>
              <label className="admin-search"><span>ค้นหาบัญชี</span><Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setUserPage(0); }} placeholder="ค้นหาด้วยชื่อ อีเมล หรือเบอร์โทรศัพท์" /></label>
            </header>
            <div className="admin-record-list">{visibleUsers.map((user) => <UserEditor key={user.id} user={user} busy={busy === `user-${user.id}`} onSave={saveAccount} onToggle={(target) => setAccountAction({ user: target, status: target.status === "active" ? "suspended" : "active" })} onDelete={(target) => { setDeleteError(""); setUserToDelete(target); }} />)}</div>
            {visibleUsers.length === 0 ? <div className="empty-state"><strong>ไม่พบบัญชีที่ตรงกับคำค้น</strong><p>ลองค้นหาด้วยชื่อ อีเมล หรือเบอร์โทรศัพท์อื่น</p></div> : <Pager label="บัญชี" page={userPage} total={data.pagination.users.total} onChange={setUserPage} />}
          </div>
        )}

        {activeTab === "bookings" && (
          <div className="admin-operation-panel">
            <header>
              <div><h2>ตรวจสอบระบบการจอง</h2><p>กดรายการเพื่อดูเวลานัด การชำระเงิน และประวัติย้อนหลัง</p></div>
              <label><span>สถานะการจอง</span><select value={bookingStatus} onChange={(event) => { setBookingStatus(event.target.value); setBookingPage(0); }}><option value="all">ทุกสถานะ</option>{Object.entries(bookingStatusCopy).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </header>
            <div className="admin-booking-list">
              {visibleBookings.map((booking) => (
                <details key={booking.id} className="admin-record-disclosure admin-booking-disclosure">
                  <summary><span><strong>{booking.id}</strong><small>{booking.memberName} กับ {booking.trainerName} · {formatDateTime(booking.startsAt)}</small></span><StatusBadge status={booking.status} /></summary>
                  <div className="admin-booking-disclosure__content">
                    <dl><div><dt>วันและเวลานัด</dt><dd>{formatDateTime(booking.startsAt)} ถึง {formatDateTime(booking.endsAt)}</dd></div><div><dt>ค่าฝึก</dt><dd>{formatMoney(booking.quotedPrice)}</dd></div><div><dt>การชำระเงิน</dt><dd>{paymentStatusLabel(booking.paymentStatus)}</dd></div></dl>
                    {data.permissions.manageBookings && ["awaiting_payment", "payment_review", "confirmed"].includes(booking.status) && (
                      <div className="admin-booking-actions my-3 p-3 bg-muted/40 rounded flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">ผู้ดูแลระบบสามารถแทรกแซงและยกเลิกคำขอนี้เพื่อคืนสล็อตว่างได้</span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy === `cancel-${booking.id}`}
                          onClick={() => { setCancelReason("ผู้ดูแลระบบยกเลิกรายการ"); setBookingToCancel(booking); }}
                        >
                          {busy === `cancel-${booking.id}` ? "กำลังยกเลิก…" : "ยกเลิกคำขอจองนี้"}
                        </Button>
                      </div>
                    )}
                    <section aria-label={`ประวัติสถานะ ${booking.id}`}><h3>ประวัติสถานะ</h3>{booking.history.length > 0 ? <ol>{booking.history.map((item, index) => <li key={`${item.createdAt}-${index}`}><strong>{bookingStatusLabel(item.toStatus)}</strong><span>{formatDateTime(item.createdAt)} · {item.changedBy ?? "ระบบ"}</span>{item.note && <p>{item.note}</p>}</li>)}</ol> : <p className="admin-inline-note">ยังไม่มีประวัติสถานะเพิ่มเติม</p>}</section>
                  </div>
                </details>
              ))}
            </div>
            {visibleBookings.length === 0 ? <div className="empty-state"><strong>ไม่มีการจองในสถานะนี้</strong><p>เลือกสถานะอื่นเพื่อดูรายการ</p></div> : <Pager label="การจอง" page={bookingPage} total={data.pagination.bookings.total} onChange={setBookingPage} />}
          </div>
        )}

        {activeTab === "finance" && (
          <div className="admin-operation-panel admin-finance">
            <header><div><h2>ตรวจสอบการชำระเงิน</h2><p>แสดงเฉพาะหลักฐานการชำระเงินที่บันทึกในระบบ</p></div></header>
            <section aria-labelledby="trainer-income-title">
              <h3 id="trainer-income-title">ตรวจสอบรายได้ของเทรนเนอร์</h3>
              <div className="admin-income-list">{visibleIncome.map((item) => <div key={item.trainerId}><span>{item.trainerName}</span><small>{item.paidSessions} นัดที่ชำระแล้ว</small><strong>{formatMoney(item.revenue)}</strong></div>)}</div>
              {data.trainerIncome.length === 0 ? <p className="admin-inline-note">ยังไม่มีรายได้ที่อนุมัติ</p> : <Pager label="รายได้เทรนเนอร์" page={incomePage} total={data.pagination.trainerIncome.total} onChange={setIncomePage} />}
            </section>
            <section aria-labelledby="transaction-history-title">
              <h3 id="transaction-history-title">ตรวจสอบประวัติการทำรายการทางการเงินย้อนหลัง</h3>
              <div className="admin-transaction-list">{visiblePayments.map((payment) => <article key={payment.id}><div><strong>PAY-{String(payment.id).padStart(6, "0")}</strong><span>{payment.bookingId} · {payment.memberName} → {payment.trainerName}</span></div><div><strong>{formatMoney(payment.amount)}</strong><StatusBadge status={payment.status} source="payment" /></div><small>ส่ง {formatDateTime(payment.submittedAt)}{payment.reviewedAt ? ` · ตรวจ ${formatDateTime(payment.reviewedAt)} โดย ${payment.reviewedBy ?? "ผู้ดูแลระบบ"}` : ""}</small></article>)}</div>
              {data.payments.length === 0 ? <p className="admin-inline-note">ยังไม่มีธุรกรรม</p> : <Pager label="ธุรกรรม" page={paymentPage} total={data.pagination.payments.total} onChange={setPaymentPage} />}
            </section>
            {gymSalaries && (
              <section aria-labelledby="gym-salary-title">
                <h3 id="gym-salary-title">เงินเดือนเทรนเนอร์ประจำยิม</h3>
                <p className="admin-inline-note">ยอดจากการชำระเงินที่อนุมัติแล้วของงานประจำฟิตเนส ย้อนหลัง 12 เดือน</p>
                {gymSalaries.length === 0 ? <p className="admin-inline-note">ยังไม่มีข้อมูลเงินเดือนในช่วงนี้</p> : (
                  <table className="admin-salary-table">
                    <caption className="sr-only">เงินเดือนเทรนเนอร์ประจำยิมแยกตามเดือน</caption>
                    <thead>
                      <tr>
                        <th scope="col">เทรนเนอร์</th>
                        <th scope="col">เดือน</th>
                        <th scope="col">จำนวนครั้ง</th>
                        <th scope="col">จำนวนเงิน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gymSalaries.map((row) => (
                        <tr key={`${row.trainerId}-${row.month}`}>
                          <th scope="row">{row.trainerName}</th>
                          <td>{monthLabel(row.month)}</td>
                          <td>{row.sessions}</td>
                          <td>{formatMoney(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </div>
        )}

        {activeTab === "reports" && (
          <div className="admin-operation-panel admin-reports">
            <header>
              <div><h2>รายงานสรุปรายเดือน</h2><p>แสดงเฉพาะส่วนที่สิทธิ์ของคุณเปิดดูได้ และดาวน์โหลดเป็นไฟล์ CSV ได้</p></div>
              <div className="admin-reports__controls">
                <label><span>ปีของรายงาน</span><select value={reportsYear} onChange={(event) => setReportsYear(Number(event.target.value))}>{Array.from({ length: 5 }, (_, index) => new Date().getFullYear() - index).map((year) => <option key={year} value={year}>พ.ศ. {year + 543}</option>)}</select></label>
                <Button type="button" variant="outline" onClick={downloadReportsCsv} disabled={!hasReportSection || reportsLoading}><Download aria-hidden="true" /> ดาวน์โหลด CSV</Button>
              </div>
            </header>
            <div className="admin-report-grid">
            {reportsLoading && <p className="queue-loading" role="status">กำลังโหลดรายงาน…</p>}
            {reportsError && <p className="row-error" role="alert">{reportsError}</p>}
            {!reportsLoading && !reportsError && !hasReportSection && <p className="admin-inline-note">ยังไม่มีข้อมูลรายงานในส่วนที่คุณมีสิทธิ์ดู</p>}
            {reportBookings && (
              <section className="admin-report-card admin-report-card--wide" aria-labelledby="report-bookings-title">
                <h3 id="report-bookings-title">การจองแยกตามสถานะ</h3>
                <table className="admin-report-table">
                  <caption className="sr-only">จำนวนการจองรายเดือนแยกตามสถานะ</caption>
                  <thead><tr><th scope="col">เดือน</th>{reportStatusColumns.map((status) => <th key={status} scope="col">{bookingStatusLabel(status)}</th>)}<th scope="col">รวม</th></tr></thead>
                  <tbody>{reportBookings.map((row) => <tr key={`bookings-${row.month}`} className={(row.total ?? 0) === 0 ? "is-empty" : undefined}><th scope="row">{monthLabel(row.month)}</th>{reportStatusColumns.map((status) => <td key={status}>{row.byStatus?.[status] ?? 0}</td>)}<td>{row.total ?? 0}</td></tr>)}</tbody>
                </table>
              </section>
            )}
            {reportIncome && (
              <section className="admin-report-card" aria-labelledby="report-income-title">
                <h3 id="report-income-title">รายได้ที่อนุมัติแล้ว</h3>
                <table className="admin-report-table">
                  <caption className="sr-only">ผลรวมรายได้ที่อนุมัติแล้วรายเดือน</caption>
                  <thead><tr><th scope="col">เดือน</th><th scope="col">จำนวนเงิน</th></tr></thead>
                  <tbody>{reportIncome.map((row) => <tr key={`income-${row.month}`} className={(row.amount ?? 0) === 0 ? "is-empty" : undefined}><th scope="row">{monthLabel(row.month)}</th><td>{formatMoney(row.amount ?? 0)}</td></tr>)}</tbody>
                </table>
              </section>
            )}
            {reportPayments && (
              <section className="admin-report-card" aria-labelledby="report-payments-title">
                <h3 id="report-payments-title">การชำระเงิน</h3>
                <table className="admin-report-table">
                  <caption className="sr-only">การชำระเงินรายเดือนแยกตามผลการตรวจ</caption>
                  <thead><tr><th scope="col">เดือน</th><th scope="col">ส่งตรวจ</th><th scope="col">อนุมัติ</th><th scope="col">ปฏิเสธ</th></tr></thead>
                  <tbody>{reportPayments.map((row) => <tr key={`payments-${row.month}`} className={(row.submitted ?? 0) + (row.approved ?? 0) + (row.rejected ?? 0) === 0 ? "is-empty" : undefined}><th scope="row">{monthLabel(row.month)}</th><td>{row.submitted ?? 0}</td><td>{row.approved ?? 0}</td><td>{row.rejected ?? 0}</td></tr>)}</tbody>
                </table>
              </section>
            )}
            {reportUsers && (
              <section className="admin-report-card" aria-labelledby="report-users-title">
                <h3 id="report-users-title">ผู้ใช้แยกตามประเภท</h3>
                <table className="admin-report-table">
                  <caption className="sr-only">จำนวนผู้ใช้แยกตามประเภทบัญชี</caption>
                  <thead><tr><th scope="col">ประเภทผู้ใช้</th><th scope="col">จำนวน</th></tr></thead>
                  <tbody>{reportUsers.map((row) => <tr key={`users-${row.role}`}><th scope="row">{reportUserRoleLabels[row.role] ?? row.role}</th><td>{row.count}</td></tr>)}</tbody>
                </table>
              </section>
            )}
            </div>
          </div>
        )}
        {activeTab === "administrators" && <div className="admin-operation-panel admin-administrators"><header><div><h2>จัดการข้อมูลของผู้ดูแลระบบ</h2><p>กำหนดได้เฉพาะสิทธิ์ที่บัญชีของคุณมีอยู่</p></div></header><form aria-label="เพิ่มผู้ดูแลระบบ" className="admin-create-form" onSubmit={createAdministrator}><h3>เพิ่มผู้ดูแลระบบ</h3><div className="admin-editor__fields"><label><span>ชื่อที่แสดง</span><Input required autoComplete="name" value={newAdmin.displayName} onChange={(event) => setNewAdmin({ ...newAdmin, displayName: event.target.value })} /></label><label><span>อีเมล</span><Input required type="email" autoComplete="email" value={newAdmin.email} onChange={(event) => setNewAdmin({ ...newAdmin, email: event.target.value })} /></label><label><span>รหัสผ่านเริ่มต้น อย่างน้อย 8 ตัวอักษร</span><Input required minLength={8} type="password" autoComplete="new-password" value={newAdmin.password} onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })} /></label></div><PermissionFields value={newAdmin.permissions} allowed={data.permissions} onChange={(permissions) => setNewAdmin({ ...newAdmin, permissions })} />{!canCreateAdministrator && <p className="admin-inline-note">เลือกสิทธิ์อย่างน้อย 1 รายการก่อนเพิ่มบัญชี</p>}<Button type="submit" disabled={busy === "create-admin" || !canCreateAdministrator}>{busy === "create-admin" ? "กำลังเพิ่ม…" : "เพิ่มผู้ดูแลระบบ"}</Button></form><section aria-labelledby="administrator-list-title"><h3 id="administrator-list-title">ผู้ดูแลระบบที่มีอยู่</h3>{data.administrators.map((user) => <AdministratorEditor key={user.id} user={user} currentUserId={data.currentUserId} assignablePermissions={data.permissions} busy={busy === `user-${user.id}`} onSave={saveAccount} onToggle={(target) => setAccountAction({ user: target, status: target.status === "active" ? "suspended" : "active" })} onDelete={(target) => { setDeleteError(""); setUserToDelete(target); }} />)}<Pager label="ผู้ดูแลระบบ" page={administratorPage} total={data.pagination.administrators.total} onChange={setAdministratorPage} /></section></div>}
        {activeTab === "administrators" && data.permissions.manageUsers && data.permissions.reviewPayments && <div className="admin-operation-panel admin-legacy-routing"><PaymentRoutingSettings /></div>}
        {activeTab === "account" && <div className="admin-operation-panel"><header><div><h2>บัญชีของฉัน</h2><p>เปลี่ยนรหัสผ่านเริ่มต้นและดูแลความปลอดภัยของบัญชีนี้</p></div></header><AdministratorPasswordForm /></div>}
      </section>

      <Dialog open={accountAction !== null} onOpenChange={(open) => { if (!open && !busy) setAccountAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{accountAction?.status === "suspended" ? "ระงับบัญชี" : "เปิดใช้งานบัญชี"}</DialogTitle>
            <DialogDescription>ตรวจสอบบัญชีก่อนยืนยันการเปลี่ยนสถานะ</DialogDescription>
          </DialogHeader>
          {accountAction && <div className="admin-dialog-target"><strong>{accountAction.user.displayName}</strong><span>{accountAction.user.email}</span></div>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy)}>ยกเลิก</Button></DialogClose>
            <Button type="button" variant={accountAction?.status === "suspended" ? "destructive" : "default"} disabled={!accountAction || Boolean(busy)} onClick={() => accountAction && void updateUser(accountAction.user, accountAction.status)}>
              {busy ? "กำลังบันทึก…" : "ยืนยันการเปลี่ยนสถานะ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bookingToCancel !== null} onOpenChange={(open) => { if (!open && !busy) setBookingToCancel(null); }}>
        <DialogContent>
          <form className="admin-dialog-form" onSubmit={(event) => { event.preventDefault(); void cancelBookingByAdmin(); }}>
            <DialogHeader>
              <DialogTitle>ยกเลิกคำขอจอง</DialogTitle>
              <DialogDescription>{bookingToCancel ? `${bookingToCancel.id} · ${bookingToCancel.memberName} กับ ${bookingToCancel.trainerName} · ${formatDateTime(bookingToCancel.startsAt)}` : ""}</DialogDescription>
            </DialogHeader>
            <label className="field">
              <span>เหตุผลในการยกเลิก</span>
              <Textarea required value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            <p className="admin-inline-note">เมื่อยืนยัน ระบบจะคืนช่วงเวลานี้ให้จองได้อีกครั้ง</p>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy)}>กลับ</Button></DialogClose>
              <Button type="submit" variant="destructive" disabled={!cancelReason.trim() || Boolean(busy)}>{busy ? "กำลังยกเลิก…" : "ยืนยันการยกเลิก"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={userToDelete !== null} onOpenChange={(open) => { if (!open && !busy) { setUserToDelete(null); setDeleteError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบบัญชีถาวร</DialogTitle>
            <DialogDescription>การลบบัญชีเป็นการลบถาวร บัญชีนี้จะถูกนำออกจากระบบและกลับมาเข้าสู่ระบบอีกไม่ได้ ไม่สามารถกู้คืนได้</DialogDescription>
          </DialogHeader>
          {userToDelete && <div className="admin-dialog-target"><strong>{userToDelete.displayName}</strong><span>{userToDelete.email}</span></div>}
          {deleteError && <p className="row-error" role="alert">{deleteError}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy)}>ยกเลิก</Button></DialogClose>
            <Button type="button" variant="destructive" disabled={!userToDelete || Boolean(busy)} onClick={() => void deleteUser()}>
              {busy ? "กำลังลบ…" : "ยืนยันลบบัญชีถาวร"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
