"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, FileUp, LoaderCircle, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { fieldDescribedBy, focusFirstInvalid } from "@/lib/profile-form";
import type { TrainerAccountProfile, TrainingType } from "@/lib/types";

const emptyForm = {
  displayName: "",
  legalName: "",
  phone: "",
  headline: "",
  bio: "",
  yearsExperience: "0",
  serviceMode: "freelance",
  gymName: "",
  priceFrom: "",
  monthlyPrice: "",
  monthlySessionCount: "",
  paymentAccountName: "",
  promptPayId: "",
};

type FormValues = typeof emptyForm;

const fieldIdByKey: Record<string, string> = {
  displayName: "apply-display-name",
  legalName: "apply-legal-name",
  phone: "apply-phone",
  headline: "apply-headline",
  bio: "apply-bio",
  yearsExperience: "apply-years",
  serviceMode: "apply-service",
  gymName: "apply-gym",
  priceFrom: "apply-price",
  monthlyPrice: "apply-monthly-price",
  monthlySessionCount: "apply-monthly-sessions",
  paymentAccountName: "apply-payment-account",
  promptPayId: "apply-promptpay",
  trainingTypeIds: "apply-training-types",
  certificate: "apply-certificate",
};

function fromProfile(profile: TrainerAccountProfile): FormValues {
  return {
    displayName: profile.user.displayName,
    legalName: profile.trainer.legalName,
    phone: profile.trainer.phone,
    headline: profile.trainer.headline,
    bio: profile.trainer.bio,
    yearsExperience: profile.trainer.yearsExperience.toString(),
    serviceMode: profile.trainer.serviceMode,
    gymName: profile.trainer.gymName ?? "",
    priceFrom: profile.trainer.priceFrom?.toString() ?? "",
    monthlyPrice: profile.trainer.monthlyPrice?.toString() ?? "",
    monthlySessionCount: profile.trainer.monthlySessionCount?.toString() ?? "",
    paymentAccountName: profile.trainer.paymentAccountName ?? "",
    promptPayId: profile.trainer.promptPayId ?? "",
  };
}

/**
 * The single place a trainer writes their professional record. It used to be
 * two half-forms: this page collected a name, a phone, one training type and a
 * PDF, while the account profile collected the headline, prices and payment
 * account, and the two overwrote each other's columns. Submitting here always
 * returns the record to the review queue, so an edit to a live storefront is
 * re-checked before it goes back on display.
 */
export function TrainerApplyForm() {
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [selectedTypes, setSelectedTypes] = useState<number[]>([]);
  const [trainingTypes, setTrainingTypes] = useState<TrainingType[]>([]);
  const [typesPending, setTypesPending] = useState(true);
  const [typeError, setTypeError] = useState("");
  const [certificate, setCertificate] = useState<File | null>(null);
  const [certificateName, setCertificateName] = useState("");
  const [certificateStatus, setCertificateStatus] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const certificateInputRef = useRef<HTMLInputElement>(null);
  // A rejected certificate is a reason to submit again, so it never counts as
  // evidence already on file.
  const hasStoredCertificate = certificateStatus !== null && certificateStatus !== "rejected";

  const loadTrainingTypes = useCallback(() => {
    setTypesPending(true);
    setTypeError("");
    authenticatedRequest<TrainingType[]>("/v1/training-types", { cache: "no-store" })
      .then((types) => {
        if (!Array.isArray(types)) throw new Error("ข้อมูลประเภทการฝึกไม่ถูกต้อง");
        setTrainingTypes(types);
      })
      .catch((loadError) => {
        setTrainingTypes([]);
        setTypeError(loadError instanceof Error ? loadError.message : "โหลดประเภทการฝึกไม่สำเร็จ");
      })
      .finally(() => setTypesPending(false));
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(loadTrainingTypes, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadTrainingTypes]);

  useEffect(() => {
    let active = true;
    authenticatedRequest<TrainerAccountProfile>("/v1/profile")
      .then((profile) => {
        if (!active || profile.role !== "trainer") return;
        setValues(fromProfile(profile));
        setSelectedTypes(profile.trainer.trainingTypeIds);
        const stored = profile.trainer.certificates[0];
        if (stored) {
          setCertificateStatus(stored.status);
          setCertificateName(stored.name);
        }
      })
      .catch((error: unknown) => {
        // A trainer with no profile yet answers 409; that is the first visit.
        if (error instanceof ApiError && (error.status === 409 || error.status === 404)) return;
        if (active) setMessage({ tone: "error", text: "โหลดข้อมูลเดิมไม่สำเร็จ กรอกข้อมูลใหม่ได้ตามปกติ" });
      })
      .finally(() => {
        if (active) setProfileReady(true);
      });
    return () => { active = false; };
  }, []);

  function change(name: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: "" }));
  }

  function toggleType(typeId: number) {
    setSelectedTypes((current) => current.includes(typeId)
      ? current.filter((id) => id !== typeId)
      : [...current, typeId].sort((a, b) => a - b));
    setFields((current) => ({ ...current, trainingTypeIds: "" }));
  }

  function pickCertificate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFields((current) => ({ ...current, certificate: "" }));
    if (!file) {
      setCertificate(null);
      return;
    }
    if (file.type !== "application/pdf" || file.size > 8 * 1024 * 1024) {
      setCertificate(null);
      setFields((current) => ({ ...current, certificate: "ใช้ไฟล์ PDF ขนาดไม่เกิน 8 MB" }));
      if (certificateInputRef.current) certificateInputRef.current.value = "";
      return;
    }
    setCertificate(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextFields: Record<string, string> = {};
    if (!values.displayName.trim()) nextFields.displayName = "กรุณากรอกชื่อที่แสดง";
    if (!values.legalName.trim()) nextFields.legalName = "กรุณากรอกชื่อจริง";
    if (!values.headline.trim()) nextFields.headline = "กรอกประโยคแนะนำตัวบนหน้าร้าน";
    if (!values.bio.trim()) nextFields.bio = "เขียนเกี่ยวกับฉันสั้น ๆ";
    if (!typeError && selectedTypes.length === 0) nextFields.trainingTypeIds = "เลือกประเภทการฝึกอย่างน้อยหนึ่งรายการ";
    if (!values.priceFrom.trim() || Number(values.priceFrom) <= 0) nextFields.priceFrom = "กรอกค่าฝึกเริ่มต้นที่มากกว่าศูนย์";
    if (!values.paymentAccountName.trim()) nextFields.paymentAccountName = "กรอกชื่อบัญชีผู้รับเงิน";
    if (!/^(?:0\d{9}|\d{13})$/.test(values.promptPayId.replace(/\D/g, ""))) {
      nextFields.promptPayId = "กรอกเบอร์พร้อมเพย์ 10 หลักหรือเลขประจำตัว 13 หลัก";
    }
    if (!Number.isInteger(Number(values.yearsExperience)) || Number(values.yearsExperience) < 0) {
      nextFields.yearsExperience = "กรอกจำนวนปีตั้งแต่ศูนย์ขึ้นไป";
    }
    if (values.serviceMode !== "freelance" && !values.gymName.trim()) {
      nextFields.gymName = "กรอกชื่อสถานที่ฝึก";
    }
    if ((values.monthlyPrice === "") !== (values.monthlySessionCount === "")) {
      if (values.monthlyPrice === "") nextFields.monthlyPrice = "กรอกราคาแพ็กเกจ 30 วัน";
      if (values.monthlySessionCount === "") nextFields.monthlySessionCount = "กรอกจำนวนครั้งในแพ็กเกจ";
    }
    if (values.monthlyPrice !== "" && Number(values.monthlyPrice) <= 0) {
      nextFields.monthlyPrice = "ราคาแพ็กเกจต้องมากกว่าศูนย์";
    }
    if (values.monthlySessionCount !== "" && (!Number.isInteger(Number(values.monthlySessionCount))
      || Number(values.monthlySessionCount) < 2 || Number(values.monthlySessionCount) > 30)) {
      nextFields.monthlySessionCount = "กรอกจำนวนครั้งตั้งแต่ 2 ถึง 30";
    }
    if (!certificate && !hasStoredCertificate) {
      nextFields.certificate = "แนบไฟล์ PDF ใบรับรองเพื่อให้ผู้ดูแลระบบตรวจ";
    }

    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      setMessage(null);
      focusFirstInvalid(Object.keys(nextFields).map((key) => fieldIdByKey[key]).filter(Boolean));
      return;
    }

    setPending(true);
    setMessage(null);
    setFields({});
    const body = new FormData();
    body.set("displayName", values.displayName.trim());
    body.set("legalName", values.legalName.trim());
    body.set("phone", values.phone.trim());
    body.set("headline", values.headline.trim());
    body.set("bio", values.bio.trim());
    body.set("yearsExperience", values.yearsExperience);
    body.set("serviceMode", values.serviceMode);
    body.set("gymName", values.serviceMode === "freelance" ? "" : values.gymName.trim());
    body.set("priceFrom", values.priceFrom);
    body.set("monthlyPrice", values.monthlyPrice);
    body.set("monthlySessionCount", values.monthlySessionCount);
    body.set("paymentAccountName", values.paymentAccountName.trim());
    body.set("promptPayId", values.promptPayId.replace(/\D/g, ""));
    for (const typeId of selectedTypes) body.append("trainingTypeIds[]", String(typeId));
    if (certificate) body.set("certificate", certificate);

    try {
      await authenticatedRequest("/v1/trainer-applications", { method: "POST", body });
      setCertificate(null);
      if (certificateInputRef.current) certificateInputRef.current.value = "";
      setMessage({
        tone: "success",
        text: "ส่งใบสมัครแล้ว โปรไฟล์จะกลับมาแสดงเมื่อผู้ดูแลระบบตรวจและอนุมัติอีกครั้ง",
      });
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setFields(submitError.fields);
        focusFirstInvalid(Object.keys(submitError.fields).map((key) => fieldIdByKey[key]).filter(Boolean));
      }
      setMessage({ tone: "error", text: submitError instanceof Error ? submitError.message : "ส่งใบสมัครไม่สำเร็จ" });
    } finally {
      setPending(false);
    }
  }

  const needsCertificate = !hasStoredCertificate;

  return (
    <form className="trainer-apply-form" onSubmit={submit} noValidate aria-busy={pending || !profileReady}>
      <div className="profile-group">
        <div className="profile-group__heading">
          <h2>ข้อมูลหน้าร้าน</h2>
          <span>สมาชิกมองเห็น</span>
        </div>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="apply-display-name">ชื่อที่แสดง</label>
            <Input id="apply-display-name" value={values.displayName} aria-required="true" aria-invalid={Boolean(fields.displayName)} aria-describedby={fieldDescribedBy("apply-display-name", fields.displayName)} onChange={(event) => change("displayName", event.target.value)} />
            {fields.displayName && <small className="profile-field-error" id="apply-display-name-error">{fields.displayName}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="apply-headline">ประโยคแนะนำตัวบนหน้าร้าน</label>
            <Input id="apply-headline" value={values.headline} placeholder="เช่น วางรากฐานความแข็งแรงอย่างเป็นระบบ" aria-required="true" aria-invalid={Boolean(fields.headline)} aria-describedby={fieldDescribedBy("apply-headline", fields.headline)} onChange={(event) => change("headline", event.target.value)} />
            {fields.headline && <small className="profile-field-error" id="apply-headline-error">{fields.headline}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="apply-bio">เกี่ยวกับฉัน</label>
            <Textarea id="apply-bio" rows={4} value={values.bio} aria-required="true" aria-invalid={Boolean(fields.bio)} aria-describedby={fieldDescribedBy("apply-bio", fields.bio)} onChange={(event) => change("bio", event.target.value)} />
            <small>อธิบายประสบการณ์และแนวทางการฝึก สมาชิกอ่านก่อนตัดสินใจจอง</small>
            {fields.bio && <small className="profile-field-error" id="apply-bio-error">{fields.bio}</small>}
          </div>
        </div>
      </div>

      <div className="profile-group">
        <div className="profile-group__heading">
          <h2>การให้บริการ</h2>
          <span>สมาชิกมองเห็น</span>
        </div>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="apply-years">ประสบการณ์ (ปี)</label>
            <Input id="apply-years" type="number" min="0" step="1" inputMode="numeric" value={values.yearsExperience} aria-invalid={Boolean(fields.yearsExperience)} aria-describedby={fieldDescribedBy("apply-years", fields.yearsExperience)} onChange={(event) => change("yearsExperience", event.target.value)} />
            {fields.yearsExperience && <small className="profile-field-error" id="apply-years-error">{fields.yearsExperience}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-service">รูปแบบการให้บริการ</label>
            <NativeSelect className="profile-select" id="apply-service" value={values.serviceMode} onChange={(event) => change("serviceMode", event.target.value)}>
              <NativeSelectOption value="freelance">ฟรีแลนซ์</NativeSelectOption>
              <NativeSelectOption value="gym">ประจำฟิตเนส</NativeSelectOption>
              <NativeSelectOption value="both">ทั้งสองแบบ</NativeSelectOption>
            </NativeSelect>
            <small>ฟรีแลนซ์เป็นผู้ตรวจสลิปเอง ส่วนแบบประจำฟิตเนสให้ผู้ดูแลระบบตรวจ</small>
          </div>
          {values.serviceMode !== "freelance" && (
            <div className="field field--full">
              <label htmlFor="apply-gym">ชื่อสถานที่ฝึก</label>
              <Input id="apply-gym" value={values.gymName} aria-invalid={Boolean(fields.gymName)} aria-describedby={fieldDescribedBy("apply-gym", fields.gymName)} onChange={(event) => change("gymName", event.target.value)} />
              {fields.gymName && <small className="profile-field-error" id="apply-gym-error">{fields.gymName}</small>}
            </div>
          )}
          <fieldset
            className="field field--full profile-training-types"
            id="apply-training-types"
            aria-describedby={fields.trainingTypeIds ? "apply-training-types-error" : typeError ? "apply-training-types-load-error" : undefined}
          >
            <legend>ประเภทการฝึก</legend>
            {typesPending && <p role="status">กำลังโหลดประเภทการฝึก</p>}
            {!typesPending && trainingTypes.map((type) => (
              <label key={type.id}>
                <input type="checkbox" checked={selectedTypes.includes(type.id)} onChange={() => toggleType(type.id)} /> {type.nameTh}
              </label>
            ))}
            {typeError && (
              <div className="profile-inline-error">
                <small className="profile-field-error" id="apply-training-types-load-error" role="alert">{typeError}</small>
                <button className="button" type="button" onClick={loadTrainingTypes}>ลองโหลดประเภทการฝึกใหม่</button>
              </div>
            )}
            {fields.trainingTypeIds && <small className="profile-field-error" id="apply-training-types-error">{fields.trainingTypeIds}</small>}
          </fieldset>
        </div>
      </div>

      <div className="profile-group">
        <div className="profile-group__heading">
          <h2>ราคา</h2>
          <span>สมาชิกมองเห็น</span>
        </div>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="apply-price">ค่าฝึกเริ่มต้น (บาท)</label>
            <Input id="apply-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.priceFrom} aria-required="true" aria-invalid={Boolean(fields.priceFrom)} aria-describedby={fieldDescribedBy("apply-price", fields.priceFrom)} onChange={(event) => change("priceFrom", event.target.value)} />
            {fields.priceFrom && <small className="profile-field-error" id="apply-price-error">{fields.priceFrom}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-monthly-price">ราคาแพ็กเกจ 30 วัน (ไม่บังคับ)</label>
            <Input id="apply-monthly-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.monthlyPrice} aria-invalid={Boolean(fields.monthlyPrice)} aria-describedby={fieldDescribedBy("apply-monthly-price", fields.monthlyPrice)} onChange={(event) => change("monthlyPrice", event.target.value)} />
            {fields.monthlyPrice && <small className="profile-field-error" id="apply-monthly-price-error">{fields.monthlyPrice}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-monthly-sessions">จำนวนครั้งในแพ็กเกจ</label>
            <Input id="apply-monthly-sessions" type="number" min="2" max="30" step="1" inputMode="numeric" value={values.monthlySessionCount} aria-invalid={Boolean(fields.monthlySessionCount)} aria-describedby={fieldDescribedBy("apply-monthly-sessions", fields.monthlySessionCount)} onChange={(event) => change("monthlySessionCount", event.target.value)} />
            <small>เว้นว่างทั้งสองช่องหากยังไม่เปิดแพ็กเกจ</small>
            {fields.monthlySessionCount && <small className="profile-field-error" id="apply-monthly-sessions-error">{fields.monthlySessionCount}</small>}
          </div>
        </div>
      </div>

      <div className="profile-group">
        <div className="profile-group__heading">
          <h2>การรับเงิน</h2>
          <span>ไม่แสดงบนหน้าร้าน</span>
        </div>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="apply-payment-account">ชื่อบัญชีรับเงิน</label>
            <Input id="apply-payment-account" value={values.paymentAccountName} aria-required="true" aria-invalid={Boolean(fields.paymentAccountName)} aria-describedby={fieldDescribedBy("apply-payment-account", fields.paymentAccountName)} onChange={(event) => change("paymentAccountName", event.target.value)} />
            {fields.paymentAccountName && <small className="profile-field-error" id="apply-payment-account-error">{fields.paymentAccountName}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-promptpay">หมายเลขพร้อมเพย์</label>
            <Input id="apply-promptpay" inputMode="numeric" autoComplete="off" value={values.promptPayId} aria-required="true" aria-invalid={Boolean(fields.promptPayId)} aria-describedby={fieldDescribedBy("apply-promptpay", fields.promptPayId)} onChange={(event) => change("promptPayId", event.target.value)} />
            <small>ใช้สร้าง QR หลังสมาชิกจอง ไม่แสดงบนหน้าร้าน · อัปโหลด QR ได้ที่หน้าโปรไฟล์</small>
            {fields.promptPayId && <small className="profile-field-error" id="apply-promptpay-error">{fields.promptPayId}</small>}
          </div>
        </div>
      </div>

      <div className="profile-group">
        <div className="profile-group__heading">
          <h2>ข้อมูลเฉพาะบัญชี</h2>
          <span>ไม่แสดงบนหน้าร้าน</span>
        </div>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="apply-legal-name">ชื่อ-นามสกุลจริง</label>
            <Input id="apply-legal-name" value={values.legalName} aria-required="true" aria-invalid={Boolean(fields.legalName)} aria-describedby={fieldDescribedBy("apply-legal-name", fields.legalName)} onChange={(event) => change("legalName", event.target.value)} />
            {fields.legalName && <small className="profile-field-error" id="apply-legal-name-error">{fields.legalName}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-phone">เบอร์โทรศัพท์</label>
            <Input id="apply-phone" type="tel" inputMode="tel" value={values.phone} aria-invalid={Boolean(fields.phone)} aria-describedby={fieldDescribedBy("apply-phone", fields.phone)} onChange={(event) => change("phone", event.target.value)} />
            {fields.phone && <small className="profile-field-error" id="apply-phone-error">{fields.phone}</small>}
          </div>
        </div>
      </div>

      <div className="profile-group">
        <div className="profile-group__heading">
          <h2>ใบรับรอง</h2>
          <span>ผู้ดูแลระบบตรวจ</span>
        </div>
        {hasStoredCertificate ? (
          <div className="trainer-apply-certificate">
            <p>
              <strong>{certificateName || "เอกสารใบรับรองจากผู้สมัคร"}</strong>
              {certificateStatus && <StatusBadge status={certificateStatus === "verified" ? "verified" : "pending"} />}
            </p>
            <p className="profile-group__hint">แนบไฟล์ใหม่เฉพาะเมื่อต้องการเปลี่ยนเอกสารเดิม มิฉะนั้นระบบจะใช้ไฟล์ที่ผู้ดูแลระบบมีอยู่แล้ว</p>
          </div>
        ) : certificateStatus === "rejected" ? (
          <p className="profile-group__hint">ใบรับรองเดิมไม่ผ่านการตรวจ กรุณาแนบไฟล์ PDF ฉบับใหม่</p>
        ) : (
          <p className="profile-group__hint">แนบไฟล์ PDF ใบรับรองเพื่อให้ผู้ดูแลระบบตรวจ ก่อนเปิดโปรไฟล์และตารางว่างให้สมาชิกจอง</p>
        )}
        <div className="field field--full">
          <label htmlFor="apply-certificate"><FileUp aria-hidden="true" size={18} /> {hasStoredCertificate ? "เปลี่ยนไฟล์ใบรับรอง (PDF ไม่เกิน 8 MB)" : "ไฟล์ใบรับรอง (PDF ไม่เกิน 8 MB)"}</label>
          <input
            ref={certificateInputRef}
            id="apply-certificate"
            type="file"
            accept="application/pdf"
            aria-required={needsCertificate}
            aria-invalid={Boolean(fields.certificate)}
            aria-describedby={fields.certificate ? "apply-certificate-error" : undefined}
            onChange={pickCertificate}
          />
          {certificate && <small>เลือกไฟล์: {certificate.name}</small>}
          {fields.certificate && <small className="profile-field-error" id="apply-certificate-error">{fields.certificate}</small>}
        </div>
      </div>

      <div className="form-message-slot" aria-live="polite">
        {message && (
          <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            <CircleAlert aria-hidden="true" size={18} /> {message.text}
          </div>
        )}
      </div>

      <div className="trainer-apply-actions">
        <Link className="button" href="/trainer">กลับไปพื้นที่เทรนเนอร์</Link>
        <button className="button button--accent" type="submit" disabled={pending || !profileReady}>
          {pending
            ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังส่งใบสมัคร</>
            : <><Save aria-hidden="true" size={18} /> ส่งใบสมัครให้ผู้ดูแลระบบตรวจ</>}
        </button>
      </div>
    </form>
  );
}
