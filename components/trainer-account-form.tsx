"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Save, Trash2, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, apiAssetUrl, authenticatedRequest } from "@/lib/api";
import { fieldDescribedBy, focusFirstInvalid } from "@/lib/profile-form";
import type { AccountProfile, TrainerAccountProfile, TrainingType } from "@/lib/types";

type TrainerAccountFormProps = {
  profile: TrainerAccountProfile;
  onSaved: (profile: AccountProfile) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function snapshot(profile: TrainerAccountProfile) {
  return {
    displayName: profile.user.displayName,
    legalName: profile.trainer.legalName,
    phone: profile.trainer.phone,
    headline: profile.trainer.headline,
    bio: profile.trainer.bio,
    yearsExperience: profile.trainer.yearsExperience.toString(),
    serviceMode: profile.trainer.serviceMode === "both" ? "gym" : profile.trainer.serviceMode,
    gymName: profile.trainer.gymName ?? "",
    priceFrom: profile.trainer.priceFrom?.toString() ?? "",
    monthlyPrice: profile.trainer.monthlyPrice?.toString() ?? "",
    monthlySessionCount: profile.trainer.monthlySessionCount?.toString() ?? "",
    paymentAccountName: profile.trainer.paymentAccountName ?? "",
    promptPayId: profile.trainer.promptPayId ?? "",
    trainingTypeIds: [...profile.trainer.trainingTypeIds].sort((a, b) => a - b),
  };
}

function TrainerPaymentQr({ profile, onSaved }: TrainerAccountFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlOverride, setUrlOverride] = useState<string | null>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const url = urlOverride === undefined ? profile.trainer.paymentQrUrl ?? null : urlOverride;

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || pending) return;
    setMessage("");
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("ใช้ไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB");
      event.target.value = "";
      return;
    }
    setPending(true);
    const body = new FormData();
    body.set("image", file);
    try {
      const result = await authenticatedRequest<{ paymentQrUrl: string }>("/v1/profile/payment-qr", { method: "POST", body });
      setUrlOverride(result.paymentQrUrl);
      onSaved({ ...profile, trainer: { ...profile.trainer, paymentQrUrl: result.paymentQrUrl } });
      setMessage("อัปโหลด QR รับเงินแล้ว");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "อัปโหลด QR ไม่สำเร็จ");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!url || pending) return;
    setPending(true);
    setMessage("");
    setError("");
    try {
      await authenticatedRequest<{ paymentQrUrl: null }>("/v1/profile/payment-qr", { method: "DELETE" });
      setUrlOverride(null);
      onSaved({ ...profile, trainer: { ...profile.trainer, paymentQrUrl: null } });
      setMessage("ลบ QR รับเงินแล้ว");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "ลบ QR ไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="profile-group trainer-payment-qr-manager">
      <div className="profile-group__heading">
        <h3>QR รับเงิน</h3>
        <span>สมาชิกมองเห็น</span>
      </div>
      <p className="profile-group__hint">อัปโหลด QR จากแอปธนาคาร สมาชิกจะใช้หลังระบบแสดงยอดชำระแล้ว</p>
      {url && <Image src={apiAssetUrl(url) as string} alt="QR รับเงินของฉัน" width={160} height={160} unoptimized />}
      <div className="trainer-payment-qr-manager__actions">
        <label className="button" htmlFor="trainer-payment-qr"><Upload aria-hidden="true" size={17} /> {url ? "เปลี่ยน QR" : "อัปโหลด QR รับเงิน"}</label>
        <input ref={inputRef} className="sr-only" id="trainer-payment-qr" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event)} />
        {url && <button className="button button--danger" type="button" disabled={pending} onClick={() => void remove()}><Trash2 aria-hidden="true" size={17} /> ลบ QR</button>}
      </div>
      <small>JPG, PNG หรือ WebP · ไม่เกิน 5 MB</small>
      {pending && <p role="status">กำลังบันทึก QR…</p>}
      {message && <p className="profile-success" role="status">{message}</p>}
      {error && <p className="profile-field-error" role="alert">{error}</p>}
    </div>
  );
}

export function TrainerAccountForm({ profile, onSaved, onDirtyChange }: TrainerAccountFormProps) {
  const [saved, setSaved] = useState(() => snapshot(profile));
  const [values, setValues] = useState(saved);
  const [selectedTypes, setSelectedTypes] = useState<number[]>(saved.trainingTypeIds);
  const [trainingTypes, setTrainingTypes] = useState<TrainingType[]>([]);
  const [typesPending, setTypesPending] = useState(true);
  const [typeError, setTypeError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const savedOffersMonthly = saved.monthlyPrice !== "" || saved.monthlySessionCount !== "";
  const [offersMonthly, setOffersMonthly] = useState(savedOffersMonthly);
  const dirty = JSON.stringify({ ...values, trainingTypeIds: selectedTypes, offersMonthly }) !== JSON.stringify({
    ...saved,
    trainingTypeIds: saved.trainingTypeIds,
    offersMonthly: savedOffersMonthly,
  });

  const loadTrainingTypes = useCallback(() => {
    setTypesPending(true);
    setTypeError("");
    authenticatedRequest<TrainingType[]>("/v1/training-types")
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

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  function change(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: "" }));
  }

  function toggleType(typeId: number) {
    setSelectedTypes((current) => current.includes(typeId) ? current.filter((id) => id !== typeId) : [...current, typeId].sort((a, b) => a - b));
    setFields((current) => ({ ...current, trainingTypeIds: "" }));
  }

  function resetSaved() {
    setValues(saved);
    setSelectedTypes(saved.trainingTypeIds);
    setOffersMonthly(savedOffersMonthly);
    setFields({});
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextFields: Record<string, string> = {};
    if (!values.displayName.trim()) nextFields.displayName = "กรุณากรอกชื่อที่แสดง";
    if (!values.legalName.trim()) nextFields.legalName = "กรุณากรอกชื่อจริง";
    if (!typeError && selectedTypes.length === 0) nextFields.trainingTypeIds = "เลือกประเภทการฝึกอย่างน้อยหนึ่งรายการ";
    if (!Number.isInteger(Number(values.yearsExperience)) || Number(values.yearsExperience) < 0) nextFields.yearsExperience = "กรอกจำนวนปีตั้งแต่ศูนย์ขึ้นไป";
    if (values.priceFrom !== "" && Number(values.priceFrom) <= 0) nextFields.priceFrom = "ค่าฝึกต้องมากกว่าศูนย์";
    if (!values.paymentAccountName.trim()) nextFields.paymentAccountName = "กรอกชื่อบัญชีผู้รับเงิน";
    if (!/^(?:0\d{9}|\d{13})$/.test(values.promptPayId.replace(/\D/g, ""))) nextFields.promptPayId = "กรอกเบอร์พร้อมเพย์ 10 หลักหรือเลขประจำตัว 13 หลัก";
    if (offersMonthly && (values.monthlyPrice === "") !== (values.monthlySessionCount === "")) {
      if (values.monthlyPrice === "") nextFields.monthlyPrice = "กรอกราคาแพ็กเกจ 30 วัน";
      if (values.monthlySessionCount === "") nextFields.monthlySessionCount = "กรอกจำนวนครั้งในแพ็กเกจ";
    }
    if (offersMonthly && values.monthlyPrice !== "" && Number(values.monthlyPrice) <= 0) nextFields.monthlyPrice = "ราคาแพ็กเกจต้องมากกว่าศูนย์";
    if (offersMonthly && values.monthlySessionCount !== "" && (!Number.isInteger(Number(values.monthlySessionCount)) || Number(values.monthlySessionCount) < 2 || Number(values.monthlySessionCount) > 30)) {
      nextFields.monthlySessionCount = "กรอกจำนวนครั้งตั้งแต่ 2 ถึง 30";
    }
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      const idByField: Record<string, string> = {
        priceFrom: "trainer-price",
        monthlyPrice: "trainer-monthly-price",
        monthlySessionCount: "trainer-monthly-sessions",
        displayName: "trainer-display-name",
        legalName: "trainer-legal-name",
        phone: "trainer-phone",
        headline: "trainer-headline",
        bio: "trainer-bio",
        yearsExperience: "trainer-years",
        serviceMode: "trainer-service",
        trainingTypeIds: "trainer-training-types",
        paymentAccountName: "trainer-payment-account-name",
        promptPayId: "trainer-promptpay-id",
      };
      focusFirstInvalid(Object.keys(nextFields).map((key) => idByField[key]).filter(Boolean));
      return;
    }

    setPending(true);
    setMessage("");
    setError("");
    setFields({});
    try {
      const result = await authenticatedRequest<TrainerAccountProfile>("/v1/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: values.displayName.trim(),
          legalName: values.legalName.trim(),
          phone: values.phone.trim(),
          headline: values.headline.trim(),
          bio: values.bio.trim(),
          yearsExperience: Number(values.yearsExperience),
          serviceMode: values.serviceMode,
          gymName: values.serviceMode === "freelance" ? "" : values.gymName.trim(),
          priceFrom: values.priceFrom === "" ? null : Number(values.priceFrom),
          trainingTypeIds: selectedTypes,
          monthlyPrice: !offersMonthly || values.monthlyPrice === "" ? null : Number(values.monthlyPrice),
          monthlySessionCount: !offersMonthly || values.monthlySessionCount === "" ? null : Number(values.monthlySessionCount),
          paymentAccountName: values.paymentAccountName.trim(),
          promptPayId: values.promptPayId.replace(/\D/g, ""),
        }),
      });
      const nextSaved = snapshot(result);
      setSaved(nextSaved);
      setValues(nextSaved);
      setSelectedTypes(nextSaved.trainingTypeIds);
      setOffersMonthly(nextSaved.monthlyPrice !== "" || nextSaved.monthlySessionCount !== "");
      onSaved(result);
      setMessage("บันทึกข้อมูลเทรนเนอร์แล้ว ชื่อ ราคา และประเภทฝึกขึ้นหน้าร้านแล้ว");
    } catch (saveError) {
      if (saveError instanceof ApiError) setFields(saveError.fields);
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลไม่สำเร็จ");
      if (saveError instanceof ApiError) {
        const idByField: Record<string, string> = {
          priceFrom: "trainer-price",
          monthlyPrice: "trainer-monthly-price",
          monthlySessionCount: "trainer-monthly-sessions",
          displayName: "trainer-display-name",
          legalName: "trainer-legal-name",
          phone: "trainer-phone",
          headline: "trainer-headline",
          bio: "trainer-bio",
          yearsExperience: "trainer-years",
          serviceMode: "trainer-service",
          trainingTypeIds: "trainer-training-types",
          paymentAccountName: "trainer-payment-account-name",
          promptPayId: "trainer-promptpay-id",
        };
        focusFirstInvalid(Object.keys(saveError.fields).map((key) => idByField[key]).filter(Boolean));
      }
    } finally {
      setPending(false);
    }
  }

  const storefrontComplete = Boolean(values.displayName.trim() && values.headline.trim() && values.bio.trim() && values.priceFrom && values.paymentAccountName.trim() && values.promptPayId.trim() && selectedTypes.length > 0);

  return (
    <section className="profile-section" aria-labelledby="trainer-details-title">
      <div className="profile-section__heading">
        <h2 id="trainer-details-title">รายละเอียดเทรนเนอร์</h2>
        <p>ชื่อที่แสดง ราคา และประเภทฝึกขึ้นหน้าร้านหลังบันทึก สถานะตรวจและใบรับรองแก้ได้เฉพาะผู้ดูแลระบบ</p>
      </div>
      <form className="trainer-account-form" onSubmit={submit} noValidate>
        <div className="profile-readiness" aria-label="ความพร้อมของหน้าร้าน">
          <div><span>สถานะการตรวจ</span><StatusBadge status={profile.trainer.approvalStatus} /></div>
          <div><span>ข้อมูลหน้าร้าน</span><strong>{storefrontComplete ? "ข้อมูลครบ" : "ควรกรอกเพิ่ม"}</strong></div>
          <div><span>ใบรับรอง</span><strong>{profile.trainer.certificates.length} รายการ</strong></div>
        </div>

        <div className="trainer-account-layout">
        <div className="profile-group">
          <div className="profile-group__heading">
            <h3>ข้อมูลหน้าร้าน</h3>
            <span>สมาชิกมองเห็น</span>
          </div>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="trainer-display-name">ชื่อที่แสดง</label>
              <Input id="trainer-display-name" value={values.displayName} aria-required="true" aria-invalid={Boolean(fields.displayName)} aria-describedby={fieldDescribedBy("trainer-display-name", fields.displayName)} onChange={(event) => change("displayName", event.target.value)} />
              {fields.displayName && <small className="profile-field-error" id="trainer-display-name-error">{fields.displayName}</small>}
            </div>
            <div className="field field--full">
              <label htmlFor="trainer-headline">ประโยคแนะนำตัวบนหน้าร้าน</label>
              <Input id="trainer-headline" value={values.headline} onChange={(event) => change("headline", event.target.value)} />
            </div>
            <div className="field field--full">
              <label htmlFor="trainer-bio">เกี่ยวกับฉัน</label>
              <Textarea id="trainer-bio" rows={2} value={values.bio} onChange={(event) => change("bio", event.target.value)} />
            </div>
          </div>
        </div>

        <div className="profile-group">
          <div className="profile-group__heading">
            <h3>การให้บริการ</h3>
            <span>สมาชิกมองเห็น</span>
          </div>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="trainer-years">ประสบการณ์ (ปี)</label>
              <Input id="trainer-years" type="number" min="0" step="1" inputMode="numeric" value={values.yearsExperience} aria-invalid={Boolean(fields.yearsExperience)} aria-describedby={fieldDescribedBy("trainer-years", fields.yearsExperience)} onChange={(event) => change("yearsExperience", event.target.value)} />
              {fields.yearsExperience && <small className="profile-field-error" id="trainer-years-error">{fields.yearsExperience}</small>}
            </div>
            <div className="field">
              <label htmlFor="trainer-service">รูปแบบการให้บริการ</label>
              <NativeSelect className="profile-select" id="trainer-service" value={values.serviceMode} onChange={(event) => change("serviceMode", event.target.value)}>
                <NativeSelectOption value="freelance">ฟรีแลนซ์</NativeSelectOption>
                <NativeSelectOption value="gym">ประจำยิม</NativeSelectOption>
              </NativeSelect>
            </div>
            <fieldset
              className="field field--full profile-training-types"
              id="trainer-training-types"
              aria-describedby={fields.trainingTypeIds ? "trainer-training-types-error" : typeError ? "trainer-training-types-load-error" : undefined}
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
                  <small className="profile-field-error" id="trainer-training-types-load-error" role="alert">{typeError}</small>
                  <button className="button" type="button" onClick={loadTrainingTypes}>ลองโหลดประเภทการฝึกใหม่</button>
                </div>
              )}
              {fields.trainingTypeIds && <small className="profile-field-error" id="trainer-training-types-error">{fields.trainingTypeIds}</small>}
            </fieldset>
          </div>
        </div>

        <div className="profile-group">
          <div className="profile-group__heading">
            <h3>ราคา</h3>
            <span>สมาชิกมองเห็น</span>
          </div>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="trainer-price">ค่าฝึกเริ่มต้น (บาท)</label>
              <Input id="trainer-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.priceFrom} aria-invalid={Boolean(fields.priceFrom)} aria-describedby={fieldDescribedBy("trainer-price", fields.priceFrom)} onChange={(event) => change("priceFrom", event.target.value)} />
              {fields.priceFrom && <small className="profile-field-error" id="trainer-price-error">{fields.priceFrom}</small>}
            </div>
            <label className="profile-monthly-toggle field--full">
              <input
                type="checkbox"
                checked={offersMonthly}
                onChange={(event) => {
                  setOffersMonthly(event.target.checked);
                  setFields((current) => ({ ...current, monthlyPrice: "", monthlySessionCount: "" }));
                }}
              />
              <span>
                <strong>เปิดรับแพ็กเกจ 30 วัน</strong>
                <small>เปิดเพื่อกำหนดราคาและจำนวนครั้งในแพ็กเกจ</small>
              </span>
            </label>
            {offersMonthly && (
              <div className="profile-monthly-fields field--full">
                <div className="field">
                  <label htmlFor="trainer-monthly-price">ราคาแพ็กเกจ 30 วัน (บาท)</label>
                  <Input id="trainer-monthly-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.monthlyPrice} aria-invalid={Boolean(fields.monthlyPrice)} aria-describedby={fieldDescribedBy("trainer-monthly-price", fields.monthlyPrice)} onChange={(event) => change("monthlyPrice", event.target.value)} />
                  {fields.monthlyPrice && <small className="profile-field-error" id="trainer-monthly-price-error">{fields.monthlyPrice}</small>}
                </div>
                <div className="field">
                  <label htmlFor="trainer-monthly-sessions">จำนวนครั้งในแพ็กเกจ</label>
                  <Input id="trainer-monthly-sessions" type="number" min="2" max="30" step="1" inputMode="numeric" value={values.monthlySessionCount} aria-invalid={Boolean(fields.monthlySessionCount)} aria-describedby={fieldDescribedBy("trainer-monthly-sessions", fields.monthlySessionCount)} onChange={(event) => change("monthlySessionCount", event.target.value)} />
                  {fields.monthlySessionCount && <small className="profile-field-error" id="trainer-monthly-sessions-error">{fields.monthlySessionCount}</small>}
                </div>
              </div>
            )}
          </div>
          <TrainerPaymentQr profile={profile} onSaved={onSaved} />
        </div>

        <div className="profile-group">
          <div className="profile-group__heading">
            <h3>ข้อมูลเฉพาะบัญชี</h3>
            <span>ไม่แสดงบนหน้าร้าน</span>
          </div>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="trainer-legal-name">ชื่อจริง</label>
              <Input id="trainer-legal-name" value={values.legalName} aria-required="true" aria-invalid={Boolean(fields.legalName)} aria-describedby={fieldDescribedBy("trainer-legal-name", fields.legalName)} onChange={(event) => change("legalName", event.target.value)} />
              {fields.legalName && <small className="profile-field-error" id="trainer-legal-name-error">{fields.legalName}</small>}
            </div>
            <div className="field">
              <label htmlFor="trainer-phone">เบอร์โทรศัพท์</label>
              <Input id="trainer-phone" inputMode="tel" value={values.phone} aria-invalid={Boolean(fields.phone)} aria-describedby={fieldDescribedBy("trainer-phone", fields.phone)} onChange={(event) => change("phone", event.target.value)} />
              {fields.phone && <small className="profile-field-error" id="trainer-phone-error">{fields.phone}</small>}
            </div>
            <div className="field">
              <label htmlFor="trainer-payment-account-name">ชื่อบัญชีรับเงิน</label>
              <Input id="trainer-payment-account-name" value={values.paymentAccountName} aria-required="true" aria-invalid={Boolean(fields.paymentAccountName)} aria-describedby={fieldDescribedBy("trainer-payment-account-name", fields.paymentAccountName)} onChange={(event) => change("paymentAccountName", event.target.value)} />
              {fields.paymentAccountName && <small className="profile-field-error" id="trainer-payment-account-name-error">{fields.paymentAccountName}</small>}
            </div>
            <div className="field">
              <label htmlFor="trainer-promptpay-id">หมายเลขพร้อมเพย์</label>
              <Input id="trainer-promptpay-id" inputMode="numeric" autoComplete="off" value={values.promptPayId} aria-required="true" aria-invalid={Boolean(fields.promptPayId)} aria-describedby={fieldDescribedBy("trainer-promptpay-id", fields.promptPayId)} onChange={(event) => change("promptPayId", event.target.value)} />
              <small>ใช้สร้าง QR หลังสมาชิกจอง ไม่แสดงบนหน้าร้าน</small>
              {fields.promptPayId && <small className="profile-field-error" id="trainer-promptpay-id-error">{fields.promptPayId}</small>}
            </div>
          </div>
        </div>

        <div className="profile-group">
          <h3>หลักฐาน</h3>
          <dl className="profile-ledger">
            <div>
              <dt>สถานะการตรวจ</dt>
              <dd><StatusBadge status={profile.trainer.approvalStatus} /></dd>
            </div>
            {profile.trainer.approvalNote && (
              <div>
                <dt>หมายเหตุจากผู้ดูแลระบบ</dt>
                <dd>{profile.trainer.approvalNote}</dd>
              </div>
            )}
            <div className="profile-ledger__stack">
              <dt className="sr-only">ใบรับรอง</dt>
              <dd>
                <details className="profile-certificates-disclosure">
                  <summary>
                    <span>
                      <strong>ใบรับรองและคุณสมบัติ</strong>
                      <small>{profile.trainer.certificates.length} รายการ</small>
                    </span>
                    <span aria-hidden="true">ดูรายละเอียด</span>
                  </summary>
                  <div className="profile-certificates-disclosure__content">
                    {profile.trainer.certificates.length === 0
                      ? <p className="profile-certificates-empty">ยังไม่มีใบรับรอง ผู้ดูแลระบบเป็นผู้เพิ่มและตรวจเอกสาร ไม่สามารถอัปโหลดจากหน้านี้</p>
                      : (
                        <ul className="profile-certificates">
                          {profile.trainer.certificates.map((certificate) => (
                            <li key={certificate.id}>
                              <span>
                                <strong>{certificate.name}</strong>
                                <small>{certificate.issuer}{certificate.issuedYear ? ` · ${certificate.issuedYear}` : ""}</small>
                              </span>
                              <StatusBadge status={certificate.status} />
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                </details>
              </dd>
            </div>
          </dl>
        </div>
        </div>

        {error && <p className="profile-form-error" role="alert">{error}</p>}
        {message && <p className="profile-success" role="status">{message}</p>}
        {dirty && (
          <div className="profile-save-bar" role="region" aria-label="การเปลี่ยนแปลงที่ยังไม่บันทึก">
            <div className="profile-save-bar__copy">
              <strong>มีการเปลี่ยนแปลงที่ยังไม่บันทึก</strong>
              <small>ข้อมูลหน้าร้านจะเปลี่ยนหลังจากบันทึก</small>
            </div>
            <div className="profile-save-bar__actions">
              <button className="button" type="button" disabled={pending} onClick={resetSaved}>คืนค่าที่บันทึกไว้</button>
              <button className="button button--accent" type="submit" disabled={pending}>
                {pending ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังบันทึก</> : <><Save aria-hidden="true" /> บันทึกข้อมูลเทรนเนอร์</>}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
