"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, MapPin } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { trainers } from "@/lib/demo-data";
import { formatDateTime, formatMoney } from "@/lib/format";

export function BookingForm({ trainerSlug, slotId }: { trainerSlug?: string; slotId?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const selection = useMemo(() => {
    const trainer = trainers.find((item) => item.slug === trainerSlug);
    const slot = trainer?.slots.find((item) => item.id === Number(slotId));
    return { trainer, slot };
  }, [slotId, trainerSlug]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection.trainer || !selection.slot) return;
    setPending(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    const token = localStorage.getItem("fitconnect_token");
    try {
      const booking = await apiRequest<{ id: string }>("/v1/bookings", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({
          trainerId: selection.trainer.id,
          slotId: selection.slot.id,
          location: data.get("location"),
          note: data.get("note"),
        }),
      });
      setMessage({ tone: "success", text: `ส่งคำขอ ${booking.id} แล้ว รอเทรนเนอร์ตอบรับก่อนชำระเงิน` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "ส่งคำขอจองไม่สำเร็จ" });
    } finally {
      setPending(false);
    }
  }

  if (!selection.trainer || !selection.slot) {
    return (
      <div className="selection-missing">
        <CircleAlert aria-hidden="true" size={28} />
        <h2>ยังเลือกเทรนเนอร์และเวลาไม่ครบ</h2>
        <p>กลับไปที่หน้าค้นหา เลือกโปรไฟล์ที่ผ่านการตรวจ และเลือกช่วงเวลาว่างก่อนส่งคำขอ</p>
        <Link className="button button--dark" href="/trainers"><ArrowLeft aria-hidden="true" size={18} /> กลับไปค้นหา</Link>
      </div>
    );
  }

  return (
    <form className="booking-form" onSubmit={onSubmit}>
      <div className="booking-summary">
        <p className="label">คำขอจอง</p>
        <h2>{selection.trainer.displayName}</h2>
        <dl>
          <div><dt>วันและเวลา</dt><dd>{formatDateTime(selection.slot.startsAt)}</dd></div>
          <div><dt>จังหวัด</dt><dd>{selection.trainer.province.nameTh}</dd></div>
          <div><dt>ราคาเริ่มต้น</dt><dd>{formatMoney(selection.trainer.priceFrom)}</dd></div>
        </dl>
        <p>ราคาสุดท้ายต้องได้รับการยืนยันจากเทรนเนอร์ก่อนเข้าสู่ขั้นตอนอัปโหลดสลิป</p>
      </div>
      <div className="booking-fields">
        <div className="field"><label htmlFor="booking-location">สถานที่ที่สะดวก</label><div className="input-with-icon"><MapPin aria-hidden="true" size={17} /><input id="booking-location" name="location" placeholder="ระบุฟิตเนสหรือจุดนัดหมาย" required /></div></div>
        <div className="field"><label htmlFor="booking-note">เป้าหมายหรือข้อจำกัดที่ควรรู้</label><textarea id="booking-note" name="note" rows={5} placeholder="เช่น ต้องการเริ่มเวทเบื้องต้น มีอาการเจ็บเข่า" /></div>
        <div className="form-message-slot" aria-live="polite">
          {message && <div className={`form-message form-message--${message.tone}`} role="status"><CircleAlert aria-hidden="true" size={18} /> {message.text}</div>}
        </div>
        <button className="button button--accent button--wide" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังส่งคำขอ</> : <>ยืนยันและส่งคำขอ <ArrowRight aria-hidden="true" size={18} /></>}</button>
      </div>
    </form>
  );
}
