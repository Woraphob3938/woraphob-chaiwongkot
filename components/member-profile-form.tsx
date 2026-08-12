"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { authenticatedRequest } from "@/lib/api";
import type { AccountProfile, MemberAccountProfile } from "@/lib/types";

type MemberProfileFormProps = {
  profile: MemberAccountProfile;
  onSaved: (profile: AccountProfile) => void;
};

export function profileFieldErrors(error: unknown) {
  return error && typeof error === "object" && "fields" in error
    ? (error as { fields: Record<string, string> }).fields
    : {};
}

export function MemberProfileForm({ profile, onSaved }: MemberProfileFormProps) {
  const [values, setValues] = useState({
    firstName: profile.member.firstName,
    lastName: profile.member.lastName,
    phone: profile.member.phone,
    fitnessGoal: profile.member.fitnessGoal,
    experienceLevel: profile.member.experienceLevel,
    weight: profile.member.weight?.toString() ?? "",
    height: profile.member.height?.toString() ?? "",
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function change(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: "" }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextFields: Record<string, string> = {};
    if (!values.firstName.trim()) nextFields.firstName = "กรุณากรอกชื่อ";
    if (!values.lastName.trim()) nextFields.lastName = "กรุณากรอกนามสกุล";
    if (values.weight !== "" && Number(values.weight) <= 0) nextFields.weight = "น้ำหนักต้องมากกว่าศูนย์";
    if (values.height !== "" && Number(values.height) <= 0) nextFields.height = "ส่วนสูงต้องมากกว่าศูนย์";
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
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
          fitnessGoal: values.fitnessGoal.trim(),
          experienceLevel: values.experienceLevel,
          weight: values.weight === "" ? null : Number(values.weight),
          height: values.height === "" ? null : Number(values.height),
        }),
      })
      .then((saved) => {
        onSaved(saved);
        setMessage("บันทึกข้อมูลสมาชิกแล้ว");
      })
      .catch((saveError: unknown) => {
        setFields(profileFieldErrors(saveError));
        const errorMessage = saveError && typeof saveError === "object" && "message" in saveError
          ? String(saveError.message)
          : "บันทึกข้อมูลไม่สำเร็จ";
        setError(errorMessage);
      })
      .finally(() => setPending(false));
  }

  return (
    <section className="profile-section" aria-labelledby="member-details-title">
      <div className="profile-section__heading">
        <div><p className="label">ข้อมูลส่วนตัว</p><h2 id="member-details-title">รายละเอียดสมาชิก</h2></div>
        <p>แก้ไขข้อมูลที่ใช้ในบัญชีและการจองของคุณ</p>
      </div>
      <form onSubmit={submit} noValidate>
        <div className="profile-form-grid">
          <div className="field"><label htmlFor="member-first-name">ชื่อ</label><Input id="member-first-name" value={values.firstName} aria-invalid={Boolean(fields.firstName)} aria-describedby={fields.firstName ? "member-first-name-error" : undefined} onChange={(event) => change("firstName", event.target.value)} />{fields.firstName && <small className="profile-field-error" id="member-first-name-error">{fields.firstName}</small>}</div>
          <div className="field"><label htmlFor="member-last-name">นามสกุล</label><Input id="member-last-name" value={values.lastName} aria-invalid={Boolean(fields.lastName)} aria-describedby={fields.lastName ? "member-last-name-error" : undefined} onChange={(event) => change("lastName", event.target.value)} />{fields.lastName && <small className="profile-field-error" id="member-last-name-error">{fields.lastName}</small>}</div>
          <div className="field"><label htmlFor="member-email">อีเมล</label><Input className="profile-readonly" id="member-email" value={profile.user.email} readOnly /></div>
          <div className="field"><label htmlFor="member-phone">เบอร์โทรศัพท์</label><Input id="member-phone" inputMode="tel" value={values.phone} aria-invalid={Boolean(fields.phone)} aria-describedby={fields.phone ? "member-phone-error" : undefined} onChange={(event) => change("phone", event.target.value)} />{fields.phone && <small className="profile-field-error" id="member-phone-error">{fields.phone}</small>}</div>
          <div className="field field--full"><label htmlFor="member-goal">เป้าหมายการออกกำลังกาย</label><Textarea id="member-goal" rows={3} value={values.fitnessGoal} onChange={(event) => change("fitnessGoal", event.target.value)} /></div>
          <div className="field"><label htmlFor="member-experience">ระดับประสบการณ์</label><NativeSelect className="profile-select" id="member-experience" value={values.experienceLevel} onChange={(event) => change("experienceLevel", event.target.value)}><NativeSelectOption value="">ยังไม่ระบุ</NativeSelectOption><NativeSelectOption value="beginner">เริ่มต้น</NativeSelectOption><NativeSelectOption value="intermediate">มีประสบการณ์</NativeSelectOption><NativeSelectOption value="advanced">ฝึกสม่ำเสมอ</NativeSelectOption></NativeSelect></div>
          <div className="field"><label htmlFor="member-weight">น้ำหนัก (กก.)</label><Input id="member-weight" type="number" min="0" step="0.01" value={values.weight} aria-invalid={Boolean(fields.weight)} aria-describedby={fields.weight ? "member-weight-error" : undefined} onChange={(event) => change("weight", event.target.value)} />{fields.weight && <small className="profile-field-error" id="member-weight-error">{fields.weight}</small>}</div>
          <div className="field"><label htmlFor="member-height">ส่วนสูง (ซม.)</label><Input id="member-height" type="number" min="0" step="0.01" value={values.height} aria-invalid={Boolean(fields.height)} aria-describedby={fields.height ? "member-height-error" : undefined} onChange={(event) => change("height", event.target.value)} />{fields.height && <small className="profile-field-error" id="member-height-error">{fields.height}</small>}</div>
        </div>
        {error && <p className="profile-form-error" role="alert">{error}</p>}
        {message && <p className="profile-success" role="status">{message}</p>}
        <div className="profile-form-actions"><Button type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังบันทึก</> : <><Save aria-hidden="true" /> บันทึกข้อมูลสมาชิก</>}</Button></div>
      </form>
    </section>
  );
}
