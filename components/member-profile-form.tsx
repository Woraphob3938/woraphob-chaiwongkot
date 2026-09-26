"use client";

import { FormEvent, useEffect, useState } from "react";
import { Dumbbell, LoaderCircle, Save, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { authenticatedRequest } from "@/lib/api";
import { fieldDescribedBy, focusFirstInvalid } from "@/lib/profile-form";
import type { AccountProfile, MemberAccountProfile } from "@/lib/types";

type MemberProfileFormProps = {
  profile: MemberAccountProfile;
  onSaved: (profile: AccountProfile) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function profileFieldErrors(error: unknown) {
  return error && typeof error === "object" && "fields" in error
    ? (error as { fields: Record<string, string> }).fields
    : {};
}

/** `birthDate` lands in `lib/types.ts` with the backend change; read it defensively. */
type MemberRecord = MemberAccountProfile["member"] & { birthDate?: string | null };

/**
 * Optional `YYYY-MM-DD` birth date: past-only, age 5–120, matching the server's
 * `ProfileRules` so the member sees the rejection before the round trip.
 */
export function validateBirthDate(value: string): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "กรอกวันเกิดให้ถูกต้อง";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) {
    return "กรอกวันเกิดให้ถูกต้อง";
  }
  const today = new Date();
  if (birth.getTime() > today.getTime()) return "วันเกิดต้องเป็นวันที่ผ่านมาแล้ว";
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  if (age < 5 || age > 120) return "อายุต้องอยู่ระหว่าง 5 ถึง 120 ปี";
  return "";
}

function snapshot(profile: MemberAccountProfile) {
  // An account with no stored name gets the display name as `firstName` (a legacy
  // fallback). Presenting that as field input made the form look pre-filled and
  // then reject the save for a missing surname, so the form starts from what is
  // actually stored and offers the display name as a placeholder instead.
  return {
    firstName: profile.member.nameFromDisplayName ? "" : profile.member.firstName,
    lastName: profile.member.lastName,
    phone: profile.member.phone,
    birthDate: (profile.member as MemberRecord).birthDate ?? "",
    fitnessGoal: profile.member.fitnessGoal,
    experienceLevel: profile.member.experienceLevel,
    weight: profile.member.weight?.toString() ?? "",
    height: profile.member.height?.toString() ?? "",
  };
}

const fieldIds: Record<string, string> = {
  firstName: "member-first-name",
  lastName: "member-last-name",
  phone: "member-phone",
  birthDate: "member-birth-date",
  fitnessGoal: "member-goal",
  experienceLevel: "member-experience",
  weight: "member-weight",
  height: "member-height",
};

function bmiLabel(value: number) {
  if (value < 18.5) return "น้ำหนักน้อย";
  if (value < 23) return "ปกติ";
  if (value < 25) return "น้ำหนักเกิน";
  return "อ้วน";
}

export function MemberProfileForm({ profile, onSaved, onDirtyChange }: MemberProfileFormProps) {
  const [saved, setSaved] = useState(() => snapshot(profile));
  const [values, setValues] = useState(saved);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    onDirtyChange?.(JSON.stringify(values) !== JSON.stringify(saved));
  }, [values, saved, onDirtyChange]);

  function change(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: "" }));
  }

  function resetSaved() {
    setValues(saved);
    setFields({});
    setError("");
    setMessage("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextFields: Record<string, string> = {};
    if (!values.firstName.trim()) nextFields.firstName = "กรุณากรอกชื่อ";
    if (!values.lastName.trim()) nextFields.lastName = "กรุณากรอกนามสกุล";
    const birthDateError = validateBirthDate(values.birthDate);
    if (birthDateError) nextFields.birthDate = birthDateError;
    if (values.weight !== "" && Number(values.weight) <= 0) nextFields.weight = "น้ำหนักต้องมากกว่าศูนย์";
    if (values.height !== "" && Number(values.height) <= 0) nextFields.height = "ส่วนสูงต้องมากกว่าศูนย์";
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      focusFirstInvalid(Object.keys(nextFields).map((key) => fieldIds[key]).filter(Boolean));
      return;
    }

    setPending(true);
    setMessage("");
    setError("");
    setFields({});
    void authenticatedRequest<MemberAccountProfile>("/v1/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          phone: values.phone.trim(),
          birthDate: values.birthDate === "" ? null : values.birthDate,
          fitnessGoal: values.fitnessGoal.trim(),
          experienceLevel: values.experienceLevel,
          weight: values.weight === "" ? null : Number(values.weight),
          height: values.height === "" ? null : Number(values.height),
        }),
      })
      .then((result) => {
        const nextSaved = snapshot(result);
        setSaved(nextSaved);
        setValues(nextSaved);
        onSaved(result);
        setMessage("บันทึกข้อมูลสมาชิกแล้ว");
      })
      .catch((saveError: unknown) => {
        const next = profileFieldErrors(saveError);
        setFields(next);
        const errorMessage = saveError && typeof saveError === "object" && "message" in saveError
          ? String(saveError.message)
          : "บันทึกข้อมูลไม่สำเร็จ";
        setError(errorMessage);
        focusFirstInvalid(Object.keys(next).map((key) => fieldIds[key]).filter(Boolean));
      })
      .finally(() => setPending(false));
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const weightKg = Number(values.weight);
  const heightM = Number(values.height) / 100;
  const bmi = weightKg > 0 && heightM > 0.5 ? weightKg / (heightM * heightM) : null;
  // The API falls back to the display name when no name is stored; show that
  // fallback as a hint instead of as a value the member appears to have saved.
  const nameFromDisplayName = profile.member.nameFromDisplayName && !saved.firstName;

  return (
    <section className="profile-section" aria-labelledby="member-details-title">
      <div className="profile-section__heading">
        <h2 id="member-details-title">รายละเอียดสมาชิก</h2>
        <p>ชื่อและนามสกุลจะกลายเป็นชื่อที่แสดงในระบบ ({profile.user.displayName}) ส่วนข้อมูลการฝึกช่วยให้เทรนเนอร์เตรียมแผนได้ตรงเป้า เห็นเฉพาะเทรนเนอร์ที่คุณจองเท่านั้น ไม่ขึ้นหน้าสาธารณะ</p>
      </div>
      <form onSubmit={submit} noValidate>
        <fieldset className="profile-card">
          <legend className="profile-card__title">
            <UserRound aria-hidden="true" size={18} /> ข้อมูลส่วนตัว
          </legend>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="member-first-name">ชื่อ</label>
            <Input id="member-first-name" value={values.firstName} placeholder={nameFromDisplayName ? profile.user.displayName : undefined} aria-required="true" aria-invalid={Boolean(fields.firstName)} aria-describedby={fieldDescribedBy("member-first-name", fields.firstName) ?? (nameFromDisplayName ? "member-name-hint" : undefined)} onChange={(event) => change("firstName", event.target.value)} />
            {nameFromDisplayName && <small id="member-name-hint">ยังไม่มีชื่อที่บันทึกไว้ ระบบใช้ชื่อที่แสดง “{profile.user.displayName}” แทน — กรอกชื่อและนามสกุลแล้วบันทึกเพื่อตั้งชื่อจริง</small>}
            {fields.firstName && <small className="profile-field-error" id="member-first-name-error">{fields.firstName}</small>}
          </div>
          <div className="field">
            <label htmlFor="member-last-name">นามสกุล</label>
            <Input id="member-last-name" value={values.lastName} aria-required="true" aria-invalid={Boolean(fields.lastName)} aria-describedby={fieldDescribedBy("member-last-name", fields.lastName)} onChange={(event) => change("lastName", event.target.value)} />
            {fields.lastName && <small className="profile-field-error" id="member-last-name-error">{fields.lastName}</small>}
          </div>
          <div className="field">
            <label htmlFor="member-phone">เบอร์โทรศัพท์</label>
            <Input id="member-phone" inputMode="tel" value={values.phone} aria-invalid={Boolean(fields.phone)} aria-describedby={fieldDescribedBy("member-phone", fields.phone)} onChange={(event) => change("phone", event.target.value)} />
            {fields.phone && <small className="profile-field-error" id="member-phone-error">{fields.phone}</small>}
          </div>
          <div className="field">
            <label htmlFor="member-birth-date">วันเกิด</label>
            <Input id="member-birth-date" type="date" value={values.birthDate} aria-invalid={Boolean(fields.birthDate)} aria-describedby={fieldDescribedBy("member-birth-date", fields.birthDate) ?? "member-birth-date-hint"} onChange={(event) => change("birthDate", event.target.value)} />
            <small id="member-birth-date-hint">ไม่บังคับ</small>
            {fields.birthDate && <small className="profile-field-error" id="member-birth-date-error">{fields.birthDate}</small>}
          </div>
        </div>
        </fieldset>
        <fieldset className="profile-card">
          <legend className="profile-card__title">
            <Dumbbell aria-hidden="true" size={18} /> ข้อมูลการฝึกและเป้าหมาย
          </legend>
        <div className="profile-form-grid">
          <div className="field">
            <label htmlFor="member-experience">ระดับประสบการณ์</label>
            <NativeSelect className="profile-select" id="member-experience" value={values.experienceLevel} onChange={(event) => change("experienceLevel", event.target.value)}>
              <NativeSelectOption value="">ยังไม่ระบุ</NativeSelectOption>
              <NativeSelectOption value="beginner">เริ่มต้น</NativeSelectOption>
              <NativeSelectOption value="intermediate">มีประสบการณ์</NativeSelectOption>
              <NativeSelectOption value="advanced">ฝึกสม่ำเสมอ</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="field">
            <label htmlFor="member-weight">น้ำหนัก (กก.)</label>
            <Input id="member-weight" type="number" min="0" step="0.01" inputMode="decimal" value={values.weight} aria-invalid={Boolean(fields.weight)} aria-describedby={fieldDescribedBy("member-weight", fields.weight) ?? "member-weight-hint"} onChange={(event) => change("weight", event.target.value)} />
            <small id="member-weight-hint">ไม่บังคับ</small>
            {fields.weight && <small className="profile-field-error" id="member-weight-error">{fields.weight}</small>}
          </div>
          <div className="field">
            <label htmlFor="member-height">ส่วนสูง (ซม.)</label>
            <Input id="member-height" type="number" min="0" step="0.01" inputMode="decimal" value={values.height} aria-invalid={Boolean(fields.height)} aria-describedby={fieldDescribedBy("member-height", fields.height) ?? "member-height-hint"} onChange={(event) => change("height", event.target.value)} />
            <small id="member-height-hint">ไม่บังคับ</small>
            {fields.height && <small className="profile-field-error" id="member-height-error">{fields.height}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="member-goal">เป้าหมายการออกกำลังกาย</label>
            <Textarea id="member-goal" rows={3} value={values.fitnessGoal} placeholder="เช่น ลดไขมัน 5 กก. ใน 3 เดือน หรือ เริ่มเล่นเวทอย่างถูกท่า" onChange={(event) => change("fitnessGoal", event.target.value)} />
          </div>
        </div>
        {bmi !== null && (
          <p className="profile-bmi" aria-live="polite">
            <span>ดัชนีมวลกาย (BMI)</span>
            <strong>{bmi.toFixed(1)}</strong>
            <small>{bmiLabel(bmi)} · คำนวณจากน้ำหนักและส่วนสูงที่กรอก</small>
          </p>
        )}
        </fieldset>
        {error && <p className="profile-form-error" role="alert">{error}</p>}
        {message && <p className="profile-success" role="status">{message}</p>}
        {dirty && (
          <div className="profile-save-bar" role="region" aria-label="การเปลี่ยนแปลงที่ยังไม่บันทึก">
            <div className="profile-save-bar__copy">
              <strong>มีการเปลี่ยนแปลงที่ยังไม่บันทึก</strong>
              <small>บันทึกก่อนออกจากหน้านี้</small>
            </div>
            <div className="profile-save-bar__actions">
              <button className="button" type="button" disabled={pending} onClick={resetSaved}>คืนค่าที่บันทึกไว้</button>
              <button className="button button--accent" type="submit" disabled={pending}>
                {pending ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังบันทึก</> : <><Save aria-hidden="true" /> บันทึกข้อมูลสมาชิก</>}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
