"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { ApiError, apiRequest, authenticatedRequest } from "@/lib/api";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { AvailabilitySlot, CreateBookingResponse, Trainer } from "@/lib/types";

function parseSlotIds(value?: string): number[] {
  if (!value) return [];
  return [...new Set(value.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

export function BookingForm({
  trainerSlug,
  slotId,
  bookingType = "single",
  slotIds,
}: {
  trainerSlug?: string;
  slotId?: string;
  bookingType?: "single" | "monthly";
  slotIds?: string;
}) {
  const router = useRouter();
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const [trainer, setTrainer] = useState<Trainer | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<AvailabilitySlot[]>([]);
  const [slotUnavailable, setSlotUnavailable] = useState(false);
  const [loading, setLoading] = useState(Boolean(trainerSlug));
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!trainerSlug) return;
    let active = true;
    void apiRequest<Trainer>(`/v1/trainers/${encodeURIComponent(trainerSlug)}`, { cache: "no-store" })
      .then((data) => {
        if (!active) return;
        const freshSlot = data.slots.find((item) => item.id === Number(slotId) && item.available) ?? null;
        const requestedIds = parseSlotIds(slotIds);
        const freshSlots = data.slots.filter((item) => requestedIds.includes(item.id) && item.available);
        setTrainer(data);
        setSelectedSlot(freshSlot);
        setSelectedSlots(freshSlots);
        setSlotUnavailable(bookingType === "monthly"
          ? freshSlots.length !== requestedIds.length || freshSlots.length !== data.monthlySessionCount
          : false);
        setMessage("");
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [bookingType, slotId, slotIds, trainerSlug]);

  async function reloadTrainer(showLoading = true) {
    if (!trainerSlug) return;
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const freshTrainer = await apiRequest<Trainer>(`/v1/trainers/${encodeURIComponent(trainerSlug)}`, { cache: "no-store" });
      setTrainer(freshTrainer);
      if (bookingType === "monthly") {
        const requestedIds = parseSlotIds(slotIds);
        const freshSlots = freshTrainer.slots.filter((item) => requestedIds.includes(item.id) && item.available);
        setSelectedSlots(freshSlots);
        setSlotUnavailable(freshSlots.length !== requestedIds.length || freshSlots.length !== freshTrainer.monthlySessionCount);
        return;
      }
      const freshSlot = freshTrainer.slots.find((item) => item.id === Number(slotId) && item.available);
      if (freshSlot) {
        setSelectedSlot(freshSlot);
        setSlotUnavailable(false);
      } else {
        setSlotUnavailable(true);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  const preservedSlot = selectedSlot?.id === Number(slotId) ? selectedSlot : null;
  const slot = trainer?.slots.find((item) => item.id === Number(slotId) && item.available) ?? preservedSlot;
  const monthly = bookingType === "monthly";
  const monthlySelectionValid = Boolean(
    trainer
    && trainer.monthlyPrice
    && trainer.monthlySessionCount
    && selectedSlots.length === trainer.monthlySessionCount,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trainer || slotUnavailable || (monthly ? !monthlySelectionValid : !slot)) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("fitconnect_token") : null;
    const userStr = typeof window !== "undefined" ? localStorage.getItem("fitconnect_user") : null;
    let isMember = Boolean(token);
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u.role && u.role !== "member") isMember = false;
      } catch {}
    }

    if (!isMember) {
      setMessage("กรุณาเข้าสู่ระบบเพื่อทำการขอจอง");
      return;
    }

    setMessage("");
    setConfirmOpen(true);
  }

  async function createBooking() {
    if (!trainer || slotUnavailable || pending || (monthly ? !monthlySelectionValid : !slot)) return;

    setPending(true);
    setMessage("");
    try {
      const booking = await authenticatedRequest<CreateBookingResponse>("/v1/bookings", {
        method: "POST",
        body: JSON.stringify(monthly
          ? { trainerId: trainer.id, bookingType: "monthly", slotIds: selectedSlots.map((item) => item.id), note }
          : { trainerId: trainer.id, slotId: slot?.id, note }),
      });
      router.push(`/member?booking=${encodeURIComponent(booking.id)}`);
    } catch (error) {
      setConfirmOpen(false);
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem("fitconnect_token");
        setMessage("กรุณาเข้าสู่ระบบเพื่อทำการขอจอง");
        return;
      }
      setMessage(error instanceof Error ? error.message : "ส่งคำขอจองไม่สำเร็จ");
      if (error instanceof ApiError && error.status === 409) await reloadTrainer(false);
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <div className="booking-loading" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" size={22} /> กำลังตรวจสอบช่วงเวลาจากระบบ…</div>;
  }

  if (loadError) {
    return (
      <div className="booking-retry" role="alert">
        <CircleAlert aria-hidden="true" size={28} />
        <h2>ยังโหลดข้อมูลสำหรับจองไม่ได้</h2>
        <p>{loadError}</p>
        <Button className="button button--dark" type="button" onClick={() => void reloadTrainer()}><RefreshCw aria-hidden="true" size={17} /> ลองโหลดข้อมูลอีกครั้ง</Button>
      </div>
    );
  }

  if (!trainer || (monthly ? !monthlySelectionValid : !slot)) {
    return (
      <div className="selection-missing">
        <CircleAlert aria-hidden="true" size={28} />
        <h2>{message || trainer ? "ช่วงเวลาที่เลือกถูกเปลี่ยน" : "ยังเลือกเทรนเนอร์และเวลาไม่ครบ"}</h2>
        {message && <p className="field-error" role="alert">{message}</p>}
        <p>กลับไปที่หน้าค้นหา เลือกโปรไฟล์ที่ผ่านการตรวจ และเลือกช่วงเวลาว่างก่อนส่งคำขอ</p>
        <Link className="button button--dark" href="/trainers"><ArrowLeft aria-hidden="true" size={18} /> กลับไปค้นหา</Link>
      </div>
    );
  }

  const bookingPrice = monthly ? trainer.monthlyPrice : trainer.priceFrom;
  const hasBookingPrice = typeof bookingPrice === "number" && bookingPrice > 0;

  return (
    <>
      <form className="booking-form" aria-label="ยืนยันการจอง" onSubmit={onSubmit}>
        <div className="booking-summary">
          <p className="label">รายละเอียดที่เลือก</p>
          <h2>{monthly ? "แพ็กเกจ 30 วัน" : "จองกับ"} <span>{trainer.displayName}</span></h2>
          <dl>
            {monthly ? (
              <>
                <div><dt>จำนวนครั้ง</dt><dd>{selectedSlots.length} ครั้ง ภายใน 30 วัน</dd></div>
                <div><dt>ช่วงเวลาที่เลือก</dt><dd><ul className="booking-session-list">{selectedSlots.map((item) => <li key={item.id}>{formatDateTime(item.startsAt)}</li>)}</ul></dd></div>
              </>
            ) : (
              <div><dt>วันและเวลา</dt><dd>{formatDateTime((slot as AvailabilitySlot).startsAt)}</dd></div>
            )}
            <div><dt>{monthly ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง"}</dt><dd>{hasBookingPrice ? formatMoney(bookingPrice as number) : "ยังไม่กำหนด"}</dd></div>
          </dl>
          <p>เมื่อยืนยัน ระบบจะล็อกช่วงเวลานี้และให้คุณส่งหลักฐานชำระเงินภายใน 10 นาที</p>
        </div>
        <div className="booking-fields">
          <div className="field"><Label htmlFor="booking-note">เป้าหมายหรือข้อจำกัดที่ควรรู้ (ไม่บังคับ)</Label><Textarea id="booking-note" name="note" rows={5} value={note} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ต้องการเริ่มเวทเบื้องต้น มีอาการเจ็บเข่า" /></div>
          {!hasBookingPrice && (
            <div className="form-message form-message--error" role="alert">
              <CircleAlert aria-hidden="true" size={18} /> เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก
            </div>
          )}
          {slotUnavailable && (
            <div className="form-message form-message--error stale-slot-guidance" role="alert">
              <CircleAlert aria-hidden="true" size={18} />
              <span>เวลาที่เลือกไม่ว่างแล้ว กรุณาเลือกเวลาใหม่</span>
              <Link href={`/trainers/${trainer.slug}`}>เลือกเวลาอื่น</Link>
            </div>
          )}
          <div className="form-message-slot" aria-live="polite">
            {message && <div className="form-message form-message--error" role="alert"><CircleAlert aria-hidden="true" size={18} /> {message}</div>}
          </div>
          <Button ref={reviewButtonRef} className="button button--accent button--wide" type="submit" disabled={pending || slotUnavailable || !hasBookingPrice}>
            ตรวจสอบและยืนยัน <ArrowRight aria-hidden="true" size={18} />
          </Button>
        </div>
      </form>

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!pending) setConfirmOpen(open); }}>
        <DialogContent
          className="booking-confirm-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            reviewButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>ยืนยันและเริ่มเวลา 10 นาที</DialogTitle>
            <DialogDescription>
              ตรวจรายละเอียดให้เรียบร้อย เพราะระบบจะเก็บเวลานี้ไว้ 10 นาทีหลังยืนยัน
            </DialogDescription>
          </DialogHeader>
          <dl className="booking-confirm-facts">
            <div><dt>เทรนเนอร์</dt><dd>{trainer.displayName}</dd></div>
            {monthly
              ? <div><dt>แพ็กเกจ</dt><dd>{selectedSlots.length} ครั้ง ภายใน 30 วัน</dd></div>
              : <div><dt>วันและเวลา</dt><dd>{formatDateTime((slot as AvailabilitySlot).startsAt)}</dd></div>}
            <div><dt>{monthly ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง"}</dt><dd>{formatMoney(bookingPrice as number)}</dd></div>
          </dl>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button" disabled={pending}>กลับไปแก้ไข</Button>
            </DialogClose>
            <Button type="button" disabled={pending} onClick={() => void createBooking()}>
              {pending
                ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังจอง…</>
                : "ยืนยันและเริ่มเวลา 10 นาที"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
