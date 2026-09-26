"use client";

import { ChangeEvent, FormEvent, MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, CircleAlert, Dumbbell, Eye, EyeOff, FileUp, LoaderCircle, LockKeyhole, RotateCcw, Save, ShieldCheck, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { validateBirthDate } from "@/components/member-profile-form";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { fieldDescribedBy, focusFirstInvalid } from "@/lib/profile-form";
import type { TrainerAccountProfile, TrainingType } from "@/lib/types";

const emptyForm = {
  displayName: "",
  nickname: "",
  legalName: "",
  phone: "",
  birthDate: "",
  education: "",
  headline: "",
  bio: "",
  yearsExperience: "0",
  serviceMode: "freelance",
  priceFrom: "",
  monthlyPrice: "",
  monthlySessionCount: "",
  paymentAccountName: "",
  promptPayId: "",
};

type FormValues = typeof emptyForm;
type TrainerApplyFormProps = {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onCancel?: () => void;
};

/** `birthDate`/`education` land in `lib/types.ts` with the backend change. */
type TrainerRecord = TrainerAccountProfile["trainer"] & { birthDate?: string | null; education?: string | null };

const fieldIdByKey: Record<string, string> = {
  displayName: "apply-display-name",
  nickname: "apply-nickname",
  legalName: "apply-legal-name",
  phone: "apply-phone",
  birthDate: "apply-birth-date",
  education: "apply-education",
  headline: "apply-headline",
  bio: "apply-bio",
  yearsExperience: "apply-years",
  serviceMode: "apply-service",
  priceFrom: "apply-price",
  monthlyPrice: "apply-monthly-price",
  monthlySessionCount: "apply-monthly-sessions",
  paymentAccountName: "apply-payment-account",
  promptPayId: "apply-promptpay",
  trainingTypeIds: "apply-training-types",
  certificate: "apply-certificate",
};

function fromProfile(profile: TrainerAccountProfile): FormValues {
  const record = profile.trainer as TrainerRecord;
  return {
    displayName: profile.user.displayName,
    nickname: record.nickname ?? "",
    legalName: record.legalName,
    phone: record.phone,
    birthDate: record.birthDate ?? "",
    education: record.education ?? "",
    headline: record.headline,
    bio: record.bio,
    yearsExperience: record.yearsExperience.toString(),
    serviceMode: profile.trainer.serviceMode,
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
export function TrainerApplyForm({ embedded = false, onDirtyChange, onSaved, onCancel }: TrainerApplyFormProps) {
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
  // The record as the server last stored it: what "คืนค่า" returns to, and what
  // decides whether the form has anything unsaved to warn about.
  const [saved, setSaved] = useState<FormValues>(emptyForm);
  const [savedTypes, setSavedTypes] = useState<number[]>([]);
  const [leavingWithChanges, setLeavingWithChanges] = useState(false);
  const certificateInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
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
        const record = fromProfile(profile);
        setValues(record);
        setSaved(record);
        setSelectedTypes(profile.trainer.trainingTypeIds);
        setSavedTypes(profile.trainer.trainingTypeIds);
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

  const hasUnsavedChanges = certificate !== null
    || selectedTypes.join(",") !== savedTypes.join(",")
    || (Object.keys(emptyForm) as Array<keyof FormValues>).some((key) => values[key] !== saved[key]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  /**
   * Put the record back to the values the server already holds, so a trainer who
   * changed their mind starts from the stored truth instead of retyping it.
   */
  function restoreSavedRecord() {
    setValues(saved);
    setSelectedTypes(savedTypes);
    setCertificate(null);
    if (certificateInputRef.current) certificateInputRef.current.value = "";
    setFields({});
    setMessage(null);
    document.getElementById("apply-display-name")?.focus();
  }

  // Leaving with unsent changes is what loses the work, so it asks first.
  function goBack(event: MouseEvent<HTMLAnchorElement>) {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    setLeavingWithChanges(true);
  }

  function cancelEditing() {
    if (hasUnsavedChanges) {
      setLeavingWithChanges(true);
      return;
    }
    onCancel?.();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextFields: Record<string, string> = {};
    if (!values.displayName.trim()) nextFields.displayName = "กรุณากรอกชื่อที่แสดง";
    if (!values.legalName.trim()) nextFields.legalName = "กรุณากรอกชื่อจริง";
    const birthDateError = validateBirthDate(values.birthDate);
    if (birthDateError) nextFields.birthDate = birthDateError;
    if (values.education.length > 255) nextFields.education = "ข้อมูลการศึกษาต้องไม่เกิน 255 ตัวอักษร";
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
    body.set("nickname", values.nickname.trim());
    body.set("legalName", values.legalName.trim());
    body.set("phone", values.phone.trim());
    body.set("birthDate", values.birthDate);
    body.set("education", values.education.trim());
    body.set("headline", values.headline.trim());
    body.set("bio", values.bio.trim());
    body.set("yearsExperience", values.yearsExperience);
    body.set("serviceMode", values.serviceMode);
    body.set("priceFrom", values.priceFrom);
    body.set("monthlyPrice", values.monthlyPrice);
    body.set("monthlySessionCount", values.monthlySessionCount);
    body.set("paymentAccountName", values.paymentAccountName.trim());
    body.set("promptPayId", values.promptPayId.replace(/\D/g, ""));
    for (const typeId of selectedTypes) body.append("trainingTypeIds[]", String(typeId));
    if (certificate) body.set("certificate", certificate);
    const submittedValues = { ...values };
    const submittedTypes = [...selectedTypes];
    const submittedCertificate = certificate;

    try {
      await authenticatedRequest("/v1/trainer-applications", { method: "POST", body });
      setSaved(submittedValues);
      setSavedTypes(submittedTypes);
      setCertificate(null);
      if (certificateInputRef.current) certificateInputRef.current.value = "";
      if (submittedCertificate) setCertificateName(submittedCertificate.name);
      setCertificateStatus("pending");
      setMessage({
        tone: "success",
        text: "ส่งใบสมัครแล้ว โปรไฟล์จะกลับมาแสดงเมื่อผู้ดูแลระบบตรวจและยืนยันอีกครั้ง",
      });
      onDirtyChange?.(false);
      onSaved?.();
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
    <form className={`trainer-apply-form${embedded ? " trainer-apply-form--embedded" : ""}`} onSubmit={submit} noValidate aria-busy={pending || !profileReady}>
      <div className="profile-group trainer-form-card">
        <div className="profile-group__heading trainer-form-card__heading">
          <span className="trainer-form-card__icon" aria-hidden="true"><Store size={20} /></span>
          <div>
            <h2>ข้อมูลหน้าร้าน</h2>
            <p>ชื่อและคำแนะนำตัวที่สมาชิกเห็นบนการ์ดและหน้าโปรไฟล์</p>
          </div>
          <span className="trainer-form-card__pill"><Eye aria-hidden="true" size={14} /> สมาชิกมองเห็น</span>
        </div>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="apply-display-name">ชื่อที่แสดง</label>
            <Input id="apply-display-name" value={values.displayName} aria-required="true" aria-invalid={Boolean(fields.displayName)} aria-describedby={fieldDescribedBy("apply-display-name", fields.displayName)} onChange={(event) => change("displayName", event.target.value)} />
            {fields.displayName && <small className="profile-field-error" id="apply-display-name-error">{fields.displayName}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-nickname">ชื่อเล่น</label>
            <Input id="apply-nickname" value={values.nickname} maxLength={60} aria-invalid={Boolean(fields.nickname)} aria-describedby={fieldDescribedBy("apply-nickname", fields.nickname) ?? "apply-nickname-hint"} onChange={(event) => change("nickname", event.target.value)} />
            <small id="apply-nickname-hint">ไม่บังคับ สมาชิกค้นหาด้วยชื่อเล่นได้</small>
            {fields.nickname && <small className="profile-field-error" id="apply-nickname-error">{fields.nickname}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-headline">ประโยคแนะนำตัวบนหน้าร้าน</label>
            <Input id="apply-headline" value={values.headline} placeholder="เช่น วางรากฐานความแข็งแรงอย่างเป็นระบบ" aria-required="true" aria-invalid={Boolean(fields.headline)} aria-describedby={fieldDescribedBy("apply-headline", fields.headline)} onChange={(event) => change("headline", event.target.value)} />
            {fields.headline && <small className="profile-field-error" id="apply-headline-error">{fields.headline}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="apply-bio">เกี่ยวกับฉัน</label>
            <Textarea id="apply-bio" rows={3} value={values.bio} aria-required="true" aria-invalid={Boolean(fields.bio)} aria-describedby={fieldDescribedBy("apply-bio", fields.bio)} onChange={(event) => change("bio", event.target.value)} />
            <small>อธิบายประสบการณ์และแนวทางการฝึก สมาชิกอ่านก่อนตัดสินใจจอง</small>
            {fields.bio && <small className="profile-field-error" id="apply-bio-error">{fields.bio}</small>}
          </div>
        </div>
      </div>

      <div className="profile-group trainer-form-card">
        <div className="profile-group__heading trainer-form-card__heading">
          <span className="trainer-form-card__icon" aria-hidden="true"><Dumbbell size={20} /></span>
          <div>
            <h2>การให้บริการและราคา</h2>
            <p>รูปแบบงาน ประเภทการฝึก และค่าฝึกที่ใช้ตอนสมาชิกจอง</p>
          </div>
          <span className="trainer-form-card__pill"><Eye aria-hidden="true" size={14} /> สมาชิกมองเห็น</span>
        </div>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="apply-years">ประสบการณ์ (ปี)</label>
            <Input id="apply-years" type="number" min="0" step="1" inputMode="numeric" value={values.yearsExperience} aria-invalid={Boolean(fields.yearsExperience)} aria-describedby={fieldDescribedBy("apply-years", fields.yearsExperience)} onChange={(event) => change("yearsExperience", event.target.value)} />
            {fields.yearsExperience && <small className="profile-field-error" id="apply-years-error">{fields.yearsExperience}</small>}
          </div>
          <fieldset className="field trainer-service-mode" id="apply-service">
            <legend>รูปแบบการให้บริการ</legend>
            <div className="trainer-service-mode__options">
              {([
                ["freelance", "ฟรีแลนซ์", "รับเงินจากสมาชิกโดยตรง"],
                ["gym", "ประจำฟิตเนส", "รายได้เข้ายิม รวมเป็นเงินเดือน"],
              ] as const).map(([value, label, hint]) => (
                <label key={value} className={values.serviceMode === value ? "is-selected" : undefined}>
                  <input type="radio" name="apply-service-mode" value={value} checked={values.serviceMode === value} onChange={() => change("serviceMode", value)} />
                  <span><strong>{label}</strong><small>{hint}</small></span>
                </label>
              ))}
            </div>
            {values.serviceMode !== "freelance" && values.serviceMode !== "gym" && (
              <small className="profile-field-error">ข้อมูลเดิมตั้งไว้ทั้งสองรูปแบบ กรุณาเลือกหนึ่งรูปแบบก่อนบันทึก</small>
            )}
            <small>ทั้งสองแบบ เทรนเนอร์เป็นผู้ยืนยันสลิปของสมาชิกเอง</small>
          </fieldset>
          <fieldset
            className="field field--full profile-training-types"
            id="apply-training-types"
            aria-describedby={fields.trainingTypeIds ? "apply-training-types-error" : typeError ? "apply-training-types-load-error" : undefined}
          >
            <legend>ประเภทการฝึก <small>เลือกได้หลายแบบ</small></legend>
            {typesPending && <p role="status">กำลังโหลดประเภทการฝึก</p>}
            {!typesPending && <div className="trainer-type-chips">{trainingTypes.map((type) => (
              <label key={type.id} className={`trainer-type-chip${selectedTypes.includes(type.id) ? " is-selected" : ""}`}>
                <input type="checkbox" checked={selectedTypes.includes(type.id)} onChange={() => toggleType(type.id)} /> {type.nameTh}
              </label>
            ))}</div>}
            {typeError && (
              <div className="profile-inline-error">
                <small className="profile-field-error" id="apply-training-types-load-error" role="alert">{typeError}</small>
                <button className="button" type="button" onClick={loadTrainingTypes}>ลองโหลดประเภทการฝึกใหม่</button>
              </div>
            )}
            {fields.trainingTypeIds && <small className="profile-field-error" id="apply-training-types-error">{fields.trainingTypeIds}</small>}
          </fieldset>
        </div>
        <div className="profile-form-grid profile-form-grid--numbers trainer-price-grid">
          <div className="field">
            <label htmlFor="apply-price">ค่าฝึกเริ่มต้น (บาท)</label>
            <div className="trainer-money-input"><span aria-hidden="true">฿</span><Input id="apply-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.priceFrom} aria-required="true" aria-invalid={Boolean(fields.priceFrom)} aria-describedby={fieldDescribedBy("apply-price", fields.priceFrom)} onChange={(event) => change("priceFrom", event.target.value)} /></div>
            {fields.priceFrom && <small className="profile-field-error" id="apply-price-error">{fields.priceFrom}</small>}
          </div>
          <div className="field">
            <label htmlFor="apply-monthly-price">ราคาแพ็กเกจ 30 วัน <span className="field-optional">ไม่บังคับ</span></label>
            <div className="trainer-money-input"><span aria-hidden="true">฿</span><Input id="apply-monthly-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.monthlyPrice} aria-invalid={Boolean(fields.monthlyPrice)} aria-describedby={fieldDescribedBy("apply-monthly-price", fields.monthlyPrice)} onChange={(event) => change("monthlyPrice", event.target.value)} /></div>
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

      <div className="profile-group trainer-form-card">
        <div className="profile-group__heading trainer-form-card__heading">
          <span className="trainer-form-card__icon" aria-hidden="true"><LockKeyhole size={20} /></span>
          <div>
            <h2>ข้อมูลเฉพาะบัญชีและการรับเงิน</h2>
            <p>ใช้ยืนยันตัวตนและสร้าง QR พร้อมเพย์หลังคุณยืนยันเวลา</p>
          </div>
          <span className="trainer-form-card__pill"><EyeOff aria-hidden="true" size={14} /> ไม่แสดงบนหน้าร้าน</span>
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
          <div className="field">
            <label htmlFor="apply-birth-date">วันเกิด</label>
            <Input id="apply-birth-date" type="date" value={values.birthDate} aria-invalid={Boolean(fields.birthDate)} aria-describedby={fieldDescribedBy("apply-birth-date", fields.birthDate) ?? "apply-birth-date-hint"} onChange={(event) => change("birthDate", event.target.value)} />
            <small id="apply-birth-date-hint">ไม่บังคับ</small>
            {fields.birthDate && <small className="profile-field-error" id="apply-birth-date-error">{fields.birthDate}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="apply-education">ข้อมูลการศึกษา</label>
            <Input id="apply-education" maxLength={255} value={values.education} placeholder="เช่น ปริญญาตรี วิทยาศาสตร์การกีฬา" aria-invalid={Boolean(fields.education)} aria-describedby={fieldDescribedBy("apply-education", fields.education) ?? "apply-education-hint"} onChange={(event) => change("education", event.target.value)} />
            <small id="apply-education-hint">ไม่บังคับ ไม่เกิน 255 ตัวอักษร</small>
            {fields.education && <small className="profile-field-error" id="apply-education-error">{fields.education}</small>}
          </div>
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

      <div className="profile-group trainer-form-card">
        <div className="profile-group__heading trainer-form-card__heading">
          <span className="trainer-form-card__icon" aria-hidden="true"><BadgeCheck size={20} /></span>
          <div>
            <h2>ใบรับรอง</h2>
            <p>ผู้ดูแลระบบตรวจก่อนเปิดโปรไฟล์ให้สมาชิกจอง</p>
          </div>
          <span className="trainer-form-card__pill"><ShieldCheck aria-hidden="true" size={14} /> ผู้ดูแลระบบตรวจ</span>
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
        <div className="field field--full trainer-certificate-drop">
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

      {/* The submit row stays in reach while the record is being filled; it used
          to sit at the bottom of a 2882px page. The result of a submission
          belongs next to the button that caused it, so the message rides here
          too. */}
      <div className="trainer-apply-submit">
        <div className="form-message-slot" aria-live="polite">
          {message && (
            <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
              <CircleAlert aria-hidden="true" size={18} /> {message.text}
            </div>
          )}
        </div>

        <div className="trainer-apply-actions">
          <span className={`trainer-apply-actions__status${hasUnsavedChanges ? " is-dirty" : ""}`}>
            <span aria-hidden="true" className="trainer-apply-actions__dot" />
            {hasUnsavedChanges ? "มีการแก้ไขที่ยังไม่บันทึก" : "ข้อมูลตรงกับที่บันทึกไว้"}
          </span>
          {embedded
            ? <button className="button button--ghost" type="button" onClick={cancelEditing}>ยกเลิก</button>
            : <Link className="button" href="/profile" onClick={goBack}>ย้อนกลับ</Link>}
          <button className="button button--ghost" type="button" onClick={restoreSavedRecord} disabled={!hasUnsavedChanges}>
            <RotateCcw aria-hidden="true" size={18} /> คืนค่า
          </button>
          <button className="button button--accent" type="submit" disabled={pending || !profileReady}>
            {pending
              ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังส่งให้ตรวจ</>
              : <><Save aria-hidden="true" size={18} /> {embedded ? "บันทึกและส่งตรวจ" : "ส่งใบสมัครให้ผู้ดูแลระบบตรวจ"}</>}
          </button>
        </div>
      </div>

      <Dialog open={leavingWithChanges} onOpenChange={(open) => { if (!open) setLeavingWithChanges(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{embedded ? "ยกเลิกการแก้ไขโดยไม่บันทึก?" : "ย้อนกลับโดยที่ยังไม่ได้ส่งใบสมัคร?"}</DialogTitle>
            <DialogDescription>ข้อความที่แก้ไว้จะหายไป และระบบยังใช้ข้อมูลเดิมที่บันทึกไว้</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button className="button" type="button">แก้ไขต่อ</button>
            </DialogClose>
            <button
              className="button button--danger"
              type="button"
              onClick={() => {
                setLeavingWithChanges(false);
                if (embedded) onCancel?.();
                else router.push("/profile");
              }}
            >
              {embedded ? "ยกเลิกและทิ้งการแก้ไข" : "ย้อนกลับโดยไม่บันทึก"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
