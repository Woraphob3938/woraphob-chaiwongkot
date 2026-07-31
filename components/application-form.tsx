"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CircleAlert, FileUp, LoaderCircle } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { provinces, trainingTypes } from "@/lib/demo-data";

export function ApplicationForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const token = localStorage.getItem("fitconnect_token");
    try {
      await apiRequest("/v1/trainer-applications", {
        method: "POST",
        body: data,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      form.reset();
      setMessage({ tone: "success", text: "ส่งเอกสารแล้ว ระบบจะเปลี่ยนสถานะเมื่อแอดมินตรวจเสร็จ" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "ส่งใบสมัครไม่สำเร็จ" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="application-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field"><label htmlFor="legal-name">ชื่อ-นามสกุล</label><input id="legal-name" name="legalName" required /></div>
        <div className="field"><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" name="phone" type="tel" inputMode="tel" required /></div>
        <div className="field"><label htmlFor="application-province">จังหวัดหลักที่ให้บริการ</label><select id="application-province" name="provinceId" defaultValue="1">{provinces.map((province) => <option key={province.id} value={province.id}>{province.nameTh}</option>)}</select></div>
        <div className="field"><label htmlFor="service-mode">รูปแบบการทำงาน</label><select id="service-mode" name="serviceMode" defaultValue="freelance"><option value="freelance">ฟรีแลนซ์</option><option value="gym">ประจำฟิตเนส</option><option value="both">ทั้งสองแบบ</option></select></div>
        <div className="field field--full"><label htmlFor="training-type">ความเชี่ยวชาญหลัก</label><select id="training-type" name="trainingTypeId" defaultValue="1">{trainingTypes.map((type) => <option key={type.id} value={type.id}>{type.nameTh}</option>)}</select></div>
        <div className="field field--full"><label htmlFor="experience">ประสบการณ์และแนวทางการฝึก</label><textarea id="experience" name="experience" rows={5} required /></div>
        <div className="field field--full">
          <label htmlFor="certificate"><FileUp aria-hidden="true" size={18} /> ใบรับรอง (PDF ไม่เกิน 8 MB)</label>
          <input id="certificate" name="certificate" type="file" accept="application/pdf" required />
        </div>
      </div>
      <div className="form-message-slot" aria-live="polite">
        {message && <div className={`form-message form-message--${message.tone}`} role="status"><CircleAlert aria-hidden="true" size={18} /> {message.text}</div>}
      </div>
      <button className="button button--accent" type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังส่ง</> : <>ส่งให้แอดมินตรวจ <ArrowRight aria-hidden="true" size={18} /></>}</button>
    </form>
  );
}
