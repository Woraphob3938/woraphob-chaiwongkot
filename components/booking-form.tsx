"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, MapPin, RefreshCw } from "lucide-react";
import { ApiError, apiRequest, authenticatedRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

export function BookingForm({ trainerSlug, slotId }: { trainerSlug?: string; slotId?: string }) {
  const router = useRouter();
  const [trainer, setTrainer] = useState<Trainer | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [slotUnavailable, setSlotUnavailable] = useState(false);
  const [loading, setLoading] = useState(Boolean(trainerSlug));
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!trainerSlug) return;
    let active = true;
    void apiRequest<Trainer>(`/v1/trainers/${encodeURIComponent(trainerSlug)}`, { cache: "no-store" })
      .then((data) => {
        if (!active) return;
        const freshSlot = data.slots.find((item) => item.id === Number(slotId) && item.available) ?? null;
        setTrainer(data);
        setSelectedSlot(freshSlot);
        setSlotUnavailable(false);
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
  }, [slotId, trainerSlug]);

  async function reloadTrainer(showLoading = true) {
    if (!trainerSlug) return;
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const freshTrainer = await apiRequest<Trainer>(`/v1/trainers/${encodeURIComponent(trainerSlug)}`, { cache: "no-store" });
      setTrainer(freshTrainer);
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trainer || !slot || slotUnavailable) return;

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
    setPending(true);
    setMessage("");
    setFieldErrors({});
    try {
      const booking = await authenticatedRequest<{ id: string; status: "pending_trainer" }>("/v1/bookings", {
        method: "POST",
        body: JSON.stringify({ trainerId: trainer.id, slotId: slot.id, location, note }),
      });
      router.push(`/member?booking=${encodeURIComponent(booking.id)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem("fitconnect_token");
        setMessage("กรุณาเข้าสู่ระบบเพื่อทำการขอจอง");
        return;
      }
      if (error instanceof ApiError) setFieldErrors(error.fields ?? {});
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

  if (!trainer || !slot) {
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

  return (
    <form className="booking-form" onSubmit={onSubmit}>
      <div className="booking-summary">
        <h2>จองกับ <span>{trainer.displayName}</span></h2>
        <dl>
          <div><dt>วันและเวลา</dt><dd>{formatDateTime(slot.startsAt)}</dd></div>
          <div><dt>จังหวัด</dt><dd>{trainer.province.nameTh}</dd></div>
          <div><dt>ราคาเริ่มต้น</dt><dd>{trainer.priceFrom == null ? "รอยืนยันราคา" : formatMoney(trainer.priceFrom)}</dd></div>
        </dl>
        <p>ราคาสุดท้ายต้องได้รับการยืนยันจากเทรนเนอร์ก่อนเข้าสู่ขั้นตอนอัปโหลดสลิป</p>
      </div>
      <div className="booking-fields">
        <div className="field">
          <Label htmlFor="booking-location">สถานที่ที่สะดวก</Label>
          <div className="input-with-icon"><MapPin aria-hidden="true" size={17} /><Input id="booking-location" name="location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="ระบุฟิตเนสหรือจุดนัดหมาย" required aria-invalid={Boolean(fieldErrors.location)} aria-describedby={fieldErrors.location ? "booking-location-error" : undefined} /></div>
          {fieldErrors.location && <small id="booking-location-error" className="field-error">{fieldErrors.location}</small>}
        </div>
        <div className="field"><Label htmlFor="booking-note">เป้าหมายหรือข้อจำกัดที่ควรรู้ (ไม่บังคับ)</Label><Textarea id="booking-note" name="note" rows={5} value={note} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ต้องการเริ่มเวทเบื้องต้น มีอาการเจ็บเข่า" /></div>
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
        <Button className="button button--accent button--wide" type="submit" disabled={pending || slotUnavailable}>{pending ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังส่งคำขอ</> : <>ยืนยันและส่งคำขอ <ArrowRight aria-hidden="true" size={18} /></>}</Button>
      </div>
    </form>
  );
}
