"use client";

import { ChangeEvent, FormEvent, MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Eye, EyeOff, FileCheck2, FileUp, LoaderCircle, RotateCcw, Save, ShieldCheck } from "lucide-react";
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
};

type FormValues = typeof emptyForm;
type TrainerApplyFormProps = {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onCancel?: () => void;
};

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
  trainingTypeIds: "apply-training-types",
  certificate: "apply-certificate",
};

/**
 * Four short steps instead of one 2,800px page. Every field stays mounted, so
 * a step switch never loses input and validation can still reach any field;
 * only the current step is shown.
 */
const APPLY_STEPS = [
  { id: "storefront", title: "หน้าร้าน", hint: "ชื่อ คำแนะนำตัว ความเชี่ยวชาญ", fields: ["displayName", "nickname", "headline", "bio", "yearsExperience", "trainingTypeIds"] },
  { id: "service", title: "บริการและราคา", hint: "รูปแบบงานและค่าฝึก", fields: ["serviceMode", "priceFrom", "monthlyPrice", "monthlySessionCount"] },
  { id: "private", title: "ข้อมูลส่วนตัว", hint: "ตัวตนและการติดต่อ", fields: ["legalName", "phone", "birthDate", "education"] },
  { id: "certificate", title: "ใบรับรองและส่ง", hint: "แนบ PDF และตรวจทาน", fields: ["certificate"] },
] as const;

function stepOfField(key: string) {
  const index = APPLY_STEPS.findIndex((definition) => (definition.fields as readonly string[]).includes(key));
  return index === -1 ? 0 : index;
}

function fromProfile(profile: TrainerAccountProfile): FormValues {
  const record = profile.trainer;
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
    serviceMode: record.serviceMode,
    priceFrom: record.priceFrom?.toString() ?? "",
    monthlyPrice: record.monthlyPrice?.toString() ?? "",
    monthlySessionCount: record.monthlySessionCount?.toString() ?? "",
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
  const [step, setStep] = useState(0);
  const [packageOpen, setPackageOpen] = useState(false);
  // A record the server already holds is being edited rather than applied for.
  const [hasSavedRecord, setHasSavedRecord] = useState(false);
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
        setPackageOpen(record.monthlyPrice !== "" || record.monthlySessionCount !== "");
        setHasSavedRecord(true);
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
    const invalid = file !== null && (file.type !== "application/pdf" || file.size > 8 * 1024 * 1024);
    if (invalid) {
      setFields((current) => ({ ...current, certificate: "ใช้ไฟล์ PDF ขนาดไม่เกิน 8 MB" }));
      if (certificateInputRef.current) certificateInputRef.current.value = "";
    }
    setCertificate(invalid ? null : file);
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
    setPackageOpen(saved.monthlyPrice !== "" || saved.monthlySessionCount !== "");
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
    if (hasUnsavedChanges) setLeavingWithChanges(true);
    else onCancel?.();
  }

  function validate(): Record<string, string> {
    const nextFields: Record<string, string> = {};
    if (!values.displayName.trim()) nextFields.displayName = "กรุณากรอกชื่อที่แสดง";
    if (!values.legalName.trim()) nextFields.legalName = "กรุณากรอกชื่อจริง";
    const birthDateError = validateBirthDate(values.birthDate);
    if (birthDateError) nextFields.birthDate = birthDateError;
    if (values.education.length > 255) nextFields.education = "ข้อมูลการศึกษาต้องไม่เกิน 255 ตัวอักษร";
    if (!values.headline.trim()) nextFields.headline = "กรอกประโยคแนะนำตัวบนหน้าร้าน";
    if (!values.bio.trim()) nextFields.bio = "เขียนเกี่ยวกับฉันสั้น ๆ";
    if (!typeError && selectedTypes.length === 0) nextFields.trainingTypeIds = "เลือกหมวดหมู่ความเชี่ยวชาญอย่างน้อยหนึ่งหมวด";
    if (!values.priceFrom.trim() || Number(values.priceFrom) <= 0) nextFields.priceFrom = "กรอกค่าฝึกเริ่มต้นที่มากกว่าศูนย์";
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

    return nextFields;
  }

  /** Required fields of a step are filled and none of its fields has an error. */
  function stepComplete(index: number) {
    const errors = validate();
    return !(APPLY_STEPS[index].fields as readonly string[]).some((key) => errors[key]);
  }

  function focusAfterRender(ids: string[]) {
    window.setTimeout(() => focusFirstInvalid(ids), 0);
  }

  function goToStep(index: number) {
    setStep(index);
    window.setTimeout(() => {
      document.getElementById(`apply-step-${APPLY_STEPS[index].id}`)?.closest("section")?.querySelector<HTMLElement>("input:not([type=hidden]), textarea")?.focus({ preventScroll: true });
      document.querySelector(".apply-wizard")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }, 0);
  }

  /** "ถัดไป" checks only the step being left, so the trainer is never stopped by fields in steps they have not reached. */
  function nextStep() {
    const errors = validate();
    const stepFields = APPLY_STEPS[step].fields as readonly string[];
    const stepErrors = Object.fromEntries(Object.entries(errors).filter(([key]) => stepFields.includes(key)));
    if (Object.keys(stepErrors).length > 0) {
      setFields((current) => ({ ...current, ...stepErrors }));
      focusAfterRender(Object.keys(stepErrors).map((key) => fieldIdByKey[key]).filter(Boolean));
      return;
    }
    goToStep(Math.min(step + 1, APPLY_STEPS.length - 1));
  }

  function togglePackage(open: boolean) {
    setPackageOpen(open);
    if (!open) {
      // Closing the package means "no package": both values go, as the API expects.
      setValues((current) => ({ ...current, monthlyPrice: "", monthlySessionCount: "" }));
      setFields((current) => ({ ...current, monthlyPrice: "", monthlySessionCount: "" }));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextFields = validate();
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      setMessage(null);
      // Land on the earliest step that still owes something, then its field.
      const firstStep = Math.min(...Object.keys(nextFields).map(stepOfField));
      setStep(firstStep);
      focusAfterRender(Object.keys(nextFields).map((key) => fieldIdByKey[key]).filter(Boolean));
      return;
    }

    setPending(true);
    setMessage(null);
    setFields({});
    const body = new FormData();
    for (const [key, value] of Object.entries(values)) body.set(key, value.trim());
    for (const typeId of selectedTypes) body.append("trainingTypeIds[]", String(typeId));
    if (certificate) body.set("certificate", certificate);

    try {
      await authenticatedRequest("/v1/trainer-applications", { method: "POST", body });
      setSaved(values);
      setSavedTypes(selectedTypes);
      setCertificate(null);
      if (certificateInputRef.current) certificateInputRef.current.value = "";
      if (certificate) setCertificateName(certificate.name);
      setCertificateStatus("pending");
      setHasSavedRecord(true);
      setMessage({ tone: "success", text: "ส่งใบสมัครแล้ว โปรไฟล์จะกลับมาแสดงเมื่อผู้ดูแลระบบตรวจและยืนยันอีกครั้ง" });
      onDirtyChange?.(false);
      onSaved?.();
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        setFields(submitError.fields);
        const keys = Object.keys(submitError.fields ?? {});
        if (keys.length > 0) setStep(Math.min(...keys.map(stepOfField)));
        focusAfterRender(keys.map((key) => fieldIdByKey[key]).filter(Boolean));
      }
      setMessage({ tone: "error", text: submitError instanceof Error ? submitError.message : "ส่งใบสมัครไม่สำเร็จ" });
    } finally {
      setPending(false);
    }
  }

  const isLastStep = step === APPLY_STEPS.length - 1;
  // A first application walks the steps and sends from the last one; an
  // existing record is being edited, so it can be saved from any step.
  const canSubmitHere = isLastStep || hasSavedRecord;
  const stepErrorCounts = APPLY_STEPS.map((definition) => definition.fields.filter((key) => Boolean(fields[key])).length);
  const serviceLabel = values.serviceMode === "gym" ? "ประจำฟิตเนส" : "ฟรีแลนซ์";
  const selectedTypeNames = trainingTypes.filter((type) => selectedTypes.includes(type.id)).map((type) => type.nameTh);

  function fieldError(key: string) {
    return fields[key] ? <small className="profile-field-error" id={`${fieldIdByKey[key]}-error`}>{fields[key]}</small> : null;
  }

  return (
    <form
      className={`trainer-apply-form apply-wizard${embedded ? " trainer-apply-form--embedded apply-wizard--embedded" : ""}`}
      aria-label="แบบฟอร์มข้อมูลวิชาชีพ"
      onSubmit={submit}
      noValidate
      aria-busy={pending || !profileReady}
    >
      <nav className="apply-steps" aria-label="ขั้นตอนการกรอกข้อมูล">
        <p className="apply-steps__count" aria-hidden="true">ขั้นที่ {step + 1} จาก {APPLY_STEPS.length}</p>
        <ol>
          {APPLY_STEPS.map((definition, index) => {
            const done = index !== step && stepComplete(index);
            const errors = stepErrorCounts[index];
            return (
              <li key={definition.id}>
                <button
                  type="button"
                  className={`apply-steps__item${index === step ? " is-current" : ""}${done ? " is-done" : ""}${errors ? " has-errors" : ""}`}
                  aria-current={index === step ? "step" : undefined}
                  onClick={() => goToStep(index)}
                >
                  <span className="apply-steps__marker" aria-hidden="true">
                    {errors ? "!" : done ? <Check size={14} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="apply-steps__text">
                    <strong>{definition.title}</strong>
                    <small>{errors ? `ต้องแก้ ${errors} ช่อง` : definition.hint}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="apply-steps__progress" aria-hidden="true"><span style={{ width: `${((step + 1) / APPLY_STEPS.length) * 100}%` }} /></div>
      </nav>

      <div className="apply-panel">
        {/* Step 1: what members see */}
        <section className={`apply-step${step === 0 ? " is-active" : ""}`} aria-labelledby="apply-step-storefront">
          <header className="apply-step__head">
            <h2 id="apply-step-storefront">ข้อมูลหน้าร้าน</h2>
            <span className="apply-visibility"><Eye aria-hidden="true" size={14} /> สมาชิกมองเห็น</span>
          </header>
          <div className="apply-grid">
            <div className="field">
              <label htmlFor="apply-display-name">ชื่อที่แสดง</label>
              <Input id="apply-display-name" value={values.displayName} placeholder="เช่น โค้ชบอล" aria-required="true" aria-invalid={Boolean(fields.displayName)} aria-describedby={fieldDescribedBy("apply-display-name", fields.displayName)} onChange={(event) => change("displayName", event.target.value)} />
              {fieldError("displayName")}
            </div>
            <div className="field">
              <label htmlFor="apply-nickname">ชื่อเล่น <span className="field-optional">ไม่บังคับ</span></label>
              <Input id="apply-nickname" value={values.nickname} maxLength={60} aria-invalid={Boolean(fields.nickname)} aria-describedby={fieldDescribedBy("apply-nickname", fields.nickname) ?? "apply-nickname-hint"} onChange={(event) => change("nickname", event.target.value)} />
              <small id="apply-nickname-hint">สมาชิกค้นหาด้วยชื่อเล่นได้</small>
              {fieldError("nickname")}
            </div>
            <div className="field field--full">
              <label htmlFor="apply-headline">ประโยคแนะนำตัวบนหน้าร้าน</label>
              <Input id="apply-headline" value={values.headline} maxLength={120} placeholder="เช่น วางรากฐานความแข็งแรงอย่างเป็นระบบ" aria-required="true" aria-invalid={Boolean(fields.headline)} aria-describedby={fieldDescribedBy("apply-headline", fields.headline)} onChange={(event) => change("headline", event.target.value)} />
              {fieldError("headline")}
            </div>
            <div className="field field--full">
              <label htmlFor="apply-bio">เกี่ยวกับฉัน</label>
              <Textarea id="apply-bio" rows={3} value={values.bio} placeholder="ประสบการณ์ แนวทางการฝึก และคนที่เหมาะกับคุณ" aria-required="true" aria-invalid={Boolean(fields.bio)} aria-describedby={fieldDescribedBy("apply-bio", fields.bio)} onChange={(event) => change("bio", event.target.value)} />
              {fieldError("bio")}
            </div>
            <div className="field apply-field--short">
              <label htmlFor="apply-years">ประสบการณ์ (ปี)</label>
              <Input id="apply-years" type="number" min="0" step="1" inputMode="numeric" value={values.yearsExperience} aria-invalid={Boolean(fields.yearsExperience)} aria-describedby={fieldDescribedBy("apply-years", fields.yearsExperience)} onChange={(event) => change("yearsExperience", event.target.value)} />
              {fieldError("yearsExperience")}
            </div>
            <fieldset
              className="field field--full apply-types"
              id="apply-training-types"
              aria-describedby={fields.trainingTypeIds ? "apply-training-types-error" : typeError ? "apply-training-types-load-error" : undefined}
            >
              <legend>หมวดหมู่ความเชี่ยวชาญ <small>เลือกได้หลายหมวด</small></legend>
              {typesPending && <p role="status">กำลังโหลดหมวดหมู่ความเชี่ยวชาญ</p>}
              {!typesPending && <div className="apply-chips">{trainingTypes.map((type) => (
                <label key={type.id} className={`apply-chip${selectedTypes.includes(type.id) ? " is-selected" : ""}`}>
                  <input type="checkbox" checked={selectedTypes.includes(type.id)} onChange={() => toggleType(type.id)} />
                  {selectedTypes.includes(type.id) && <Check aria-hidden="true" size={14} strokeWidth={3} />}
                  {type.nameTh}
                </label>
              ))}</div>}
              {typeError && (
                <div className="profile-inline-error">
                  <small className="profile-field-error" id="apply-training-types-load-error" role="alert">{typeError}</small>
                  <button className="button" type="button" onClick={loadTrainingTypes}>ลองโหลดใหม่</button>
                </div>
              )}
              {fields.trainingTypeIds && <small className="profile-field-error" id="apply-training-types-error">{fields.trainingTypeIds}</small>}
            </fieldset>
          </div>
        </section>

        {/* Step 2: how the trainer works and charges */}
        <section className={`apply-step${step === 1 ? " is-active" : ""}`} aria-labelledby="apply-step-service">
          <header className="apply-step__head">
            <h2 id="apply-step-service">บริการและราคา</h2>
            <span className="apply-visibility"><Eye aria-hidden="true" size={14} /> สมาชิกมองเห็น</span>
          </header>
          <fieldset className="field apply-service" id="apply-service">
            <legend>รูปแบบการให้บริการ</legend>
            <div className="apply-service__options">
              {([
                ["freelance", "ฟรีแลนซ์", "สมาชิกโอนเงินเข้าบัญชีคุณโดยตรง"],
                ["gym", "ประจำฟิตเนส", "รายได้เข้ายิม แล้วรวมเป็นเงินเดือน"],
              ] as const).map(([value, label, hint]) => (
                <label key={value} className={`apply-option${values.serviceMode === value ? " is-selected" : ""}`}>
                  <input type="radio" name="apply-service-mode" value={value} checked={values.serviceMode === value} onChange={() => change("serviceMode", value)} />
                  <span><strong>{label}</strong><small>{hint}</small></span>
                </label>
              ))}
            </div>
            {values.serviceMode !== "freelance" && values.serviceMode !== "gym" && (
              <small className="profile-field-error">ข้อมูลเดิมตั้งไว้ทั้งสองรูปแบบ กรุณาเลือกหนึ่งรูปแบบก่อนบันทึก</small>
            )}
            <small>สมาชิกชำระผ่านระบบทั้งสองแบบ แบบฟรีแลนซ์รับเงินเข้าบัญชีรับเงินที่เชื่อมไว้ในแท็บการเงิน</small>
          </fieldset>

          <div className="apply-grid">
            <div className="field apply-field--short">
              <label htmlFor="apply-price">ค่าฝึกเริ่มต้น (บาท)</label>
              <div className="trainer-money-input"><span aria-hidden="true">฿</span><Input id="apply-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.priceFrom} aria-required="true" aria-invalid={Boolean(fields.priceFrom)} aria-describedby={fieldDescribedBy("apply-price", fields.priceFrom) ?? "apply-price-hint"} onChange={(event) => change("priceFrom", event.target.value)} /></div>
              <small id="apply-price-hint">ราคาต่อครั้ง (1 วัน) ที่สมาชิกเห็นตอนจอง</small>
              {fieldError("priceFrom")}
            </div>
          </div>

          <div className={`apply-package${packageOpen ? " is-open" : ""}`}>
            <label className="apply-switch">
              <input type="checkbox" role="switch" checked={packageOpen} aria-checked={packageOpen} onChange={(event) => togglePackage(event.target.checked)} />
              <span className="apply-switch__track" aria-hidden="true"><span /></span>
              <span><strong>เปิดแพ็กเกจ 30 วัน</strong><small>ขายหลายครั้งในราคาเหมาต่อเดือน</small></span>
            </label>
            {packageOpen && (
              <div className="apply-grid">
                <div className="field">
                  <label htmlFor="apply-monthly-price">ราคาแพ็กเกจ 30 วัน</label>
                  <div className="trainer-money-input"><span aria-hidden="true">฿</span><Input id="apply-monthly-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.monthlyPrice} aria-invalid={Boolean(fields.monthlyPrice)} aria-describedby={fieldDescribedBy("apply-monthly-price", fields.monthlyPrice)} onChange={(event) => change("monthlyPrice", event.target.value)} /></div>
                  {fieldError("monthlyPrice")}
                </div>
                <div className="field">
                  <label htmlFor="apply-monthly-sessions">จำนวนครั้งในแพ็กเกจ</label>
                  <Input id="apply-monthly-sessions" type="number" min="2" max="30" step="1" inputMode="numeric" value={values.monthlySessionCount} aria-invalid={Boolean(fields.monthlySessionCount)} aria-describedby={fieldDescribedBy("apply-monthly-sessions", fields.monthlySessionCount) ?? "apply-monthly-sessions-hint"} onChange={(event) => change("monthlySessionCount", event.target.value)} />
                  <small id="apply-monthly-sessions-hint">2 ถึง 30 ครั้ง</small>
                  {fieldError("monthlySessionCount")}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Step 3: private identity and payout */}
        <section className={`apply-step${step === 2 ? " is-active" : ""}`} aria-labelledby="apply-step-private">
          <header className="apply-step__head">
            <h2 id="apply-step-private">ข้อมูลส่วนตัวและการรับเงิน</h2>
            <span className="apply-visibility is-private"><EyeOff aria-hidden="true" size={14} /> ไม่แสดงบนหน้าร้าน</span>
          </header>
          <div className="apply-grid">
            <div className="field">
              <label htmlFor="apply-legal-name">ชื่อ-นามสกุลจริง</label>
              <Input id="apply-legal-name" value={values.legalName} autoComplete="name" aria-required="true" aria-invalid={Boolean(fields.legalName)} aria-describedby={fieldDescribedBy("apply-legal-name", fields.legalName)} onChange={(event) => change("legalName", event.target.value)} />
              {fieldError("legalName")}
            </div>
            <div className="field">
              <label htmlFor="apply-phone">เบอร์โทรศัพท์ <span className="field-optional">ไม่บังคับ</span></label>
              <Input id="apply-phone" type="tel" inputMode="tel" autoComplete="tel" value={values.phone} aria-invalid={Boolean(fields.phone)} aria-describedby={fieldDescribedBy("apply-phone", fields.phone)} onChange={(event) => change("phone", event.target.value)} />
              {fieldError("phone")}
            </div>
            <div className="field">
              <label htmlFor="apply-birth-date">วันเกิด <span className="field-optional">ไม่บังคับ</span></label>
              <Input id="apply-birth-date" type="date" value={values.birthDate} aria-invalid={Boolean(fields.birthDate)} aria-describedby={fieldDescribedBy("apply-birth-date", fields.birthDate)} onChange={(event) => change("birthDate", event.target.value)} />
              {fieldError("birthDate")}
            </div>
            <div className="field">
              <label htmlFor="apply-education">ข้อมูลการศึกษา <span className="field-optional">ไม่บังคับ</span></label>
              <Input id="apply-education" maxLength={255} value={values.education} placeholder="เช่น ปริญญาตรี วิทยาศาสตร์การกีฬา" aria-invalid={Boolean(fields.education)} aria-describedby={fieldDescribedBy("apply-education", fields.education)} onChange={(event) => change("education", event.target.value)} />
              {fieldError("education")}
            </div>
          </div>
        </section>

        {/* Step 4: evidence and a last look */}
        <section className={`apply-step${step === 3 ? " is-active" : ""}`} aria-labelledby="apply-step-certificate">
          <header className="apply-step__head">
            <h2 id="apply-step-certificate">ใบรับรองและตรวจทาน</h2>
            <span className="apply-visibility"><ShieldCheck aria-hidden="true" size={14} /> ผู้ดูแลระบบตรวจ</span>
          </header>

          {hasStoredCertificate ? (
            <div className="apply-certificate-on-file">
              <FileCheck2 aria-hidden="true" size={20} />
              <span><strong>{certificateName || "เอกสารใบรับรองจากผู้สมัคร"}</strong><small>ใช้ไฟล์เดิมได้ แนบใหม่เฉพาะเมื่อต้องการเปลี่ยน</small></span>
              {certificateStatus && <StatusBadge status={certificateStatus === "verified" ? "verified" : "pending"} />}
            </div>
          ) : certificateStatus === "rejected" ? (
            <p className="apply-note is-warning">ใบรับรองเดิมไม่ผ่านการตรวจ กรุณาแนบไฟล์ PDF ฉบับใหม่</p>
          ) : null}

          <div className={`apply-drop${certificate ? " has-file" : ""}${fields.certificate ? " is-invalid" : ""}`}>
            <input
              ref={certificateInputRef}
              id="apply-certificate"
              type="file"
              accept="application/pdf"
              aria-required={!hasStoredCertificate}
              aria-invalid={Boolean(fields.certificate)}
              aria-describedby={fields.certificate ? "apply-certificate-error" : undefined}
              onChange={pickCertificate}
            />
            <label htmlFor="apply-certificate">
              <FileUp aria-hidden="true" size={24} />
              <strong>{certificate ? certificate.name : hasStoredCertificate ? "เปลี่ยนไฟล์ใบรับรอง (PDF ไม่เกิน 8 MB)" : "ไฟล์ใบรับรอง (PDF ไม่เกิน 8 MB)"}</strong>
              <small>{certificate ? "เลือกไฟล์แล้ว กดอีกครั้งเพื่อเปลี่ยน" : "กดเพื่อเลือกไฟล์ใบรับรองวิชาชีพ"}</small>
            </label>
          </div>
          {fieldError("certificate")}

          <dl className="apply-review" aria-label="สรุปข้อมูลก่อนส่ง">
            <div><dt>หน้าร้าน</dt><dd>{values.displayName || "—"}{selectedTypeNames.length > 0 && ` · ${selectedTypeNames.join(", ")}`}</dd><button type="button" onClick={() => goToStep(0)}>แก้ไข</button></div>
            <div><dt>บริการและราคา</dt><dd>{serviceLabel}{values.priceFrom && ` · ฿${values.priceFrom} ต่อครั้ง`}{packageOpen && values.monthlyPrice && ` · แพ็กเกจ ฿${values.monthlyPrice}`}</dd><button type="button" onClick={() => goToStep(1)}>แก้ไข</button></div>
            <div><dt>ข้อมูลส่วนตัว</dt><dd>{values.legalName || "—"}{values.phone && ` · ${values.phone}`}</dd><button type="button" onClick={() => goToStep(2)}>แก้ไข</button></div>
          </dl>
          <p className="apply-note">ส่งแล้วโปรไฟล์จะเข้าคิวให้ผู้ดูแลระบบตรวจ และเปิดให้สมาชิกจองเมื่อผ่านการตรวจ</p>
        </section>
      </div>

      <div className="trainer-apply-submit apply-footer">
        <div className="form-message-slot" aria-live="polite">
          {message && (
            <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
              <CircleAlert aria-hidden="true" size={18} /> {message.text}
            </div>
          )}
        </div>
        <div className="apply-footer__row">
          <div className="apply-footer__secondary">
            {embedded
              ? <button className="button button--ghost" type="button" onClick={cancelEditing}>ยกเลิก</button>
              : <Link className="button button--ghost" href="/profile" onClick={goBack}>ย้อนกลับ</Link>}
            <button className="button button--ghost" type="button" onClick={restoreSavedRecord} disabled={!hasUnsavedChanges}>
              <RotateCcw aria-hidden="true" size={16} /> คืนค่า
            </button>
            <span className={`trainer-apply-actions__status${hasUnsavedChanges ? " is-dirty" : ""}`}>
              <span aria-hidden="true" className="trainer-apply-actions__dot" />
              {hasUnsavedChanges ? "มีการแก้ไขที่ยังไม่บันทึก" : "ข้อมูลตรงกับที่บันทึกไว้"}
            </span>
          </div>
          <div className="apply-footer__primary">
            {step > 0 && (
              <button className="button" type="button" onClick={() => goToStep(step - 1)}>
                <ArrowLeft aria-hidden="true" size={16} /> ก่อนหน้า
              </button>
            )}
            {!isLastStep && (
              <button className={canSubmitHere ? "button" : "button button--accent"} type="button" onClick={nextStep}>
                ถัดไป <ArrowRight aria-hidden="true" size={16} />
              </button>
            )}
            {canSubmitHere && (
              <button className="button button--accent" type="submit" disabled={pending || !profileReady}>
                {pending
                  ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังส่งให้ตรวจ</>
                  : <><Save aria-hidden="true" size={18} /> {embedded ? "บันทึกและส่งตรวจ" : "ส่งใบสมัครให้ผู้ดูแลระบบตรวจ"}</>}
              </button>
            )}
          </div>
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
