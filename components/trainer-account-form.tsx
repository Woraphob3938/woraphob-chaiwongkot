"use client";

import { FormEvent, useEffect, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest } from "@/lib/api";
import type { AccountProfile, TrainerAccountProfile, TrainingType } from "@/lib/types";

type TrainerAccountFormProps = {
  profile: TrainerAccountProfile;
  onSaved: (profile: AccountProfile) => void;
};

export function TrainerAccountForm({ profile, onSaved }: TrainerAccountFormProps) {
  const [values, setValues] = useState({
    displayName: profile.user.displayName, legalName: profile.trainer.legalName, phone: profile.trainer.phone,
    headline: profile.trainer.headline, bio: profile.trainer.bio,
    yearsExperience: profile.trainer.yearsExperience.toString(), serviceMode: profile.trainer.serviceMode,
    gymName: profile.trainer.gymName ?? "", priceFrom: profile.trainer.priceFrom?.toString() ?? "",
  });
  const [selectedTypes, setSelectedTypes] = useState<number[]>(profile.trainer.trainingTypeIds);
  const [trainingTypes, setTrainingTypes] = useState<TrainingType[]>([]);
  const [typeError, setTypeError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    authenticatedRequest<TrainingType[]>("/v1/training-types")
      .then((types) => {
        if (!Array.isArray(types)) throw new Error("ข้อมูลประเภทการฝึกไม่ถูกต้อง");
        if (active) setTrainingTypes(types);
      })
      .catch((loadError) => { if (active) setTypeError(loadError instanceof Error ? loadError.message : "โหลดประเภทการฝึกไม่สำเร็จ"); });
    return () => { active = false; };
  }, []);

  function change(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: "" }));
  }

  function toggleType(typeId: number) {
    setSelectedTypes((current) => current.includes(typeId) ? current.filter((id) => id !== typeId) : [...current, typeId].sort((a, b) => a - b));
    setFields((current) => ({ ...current, trainingTypeIds: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextFields: Record<string, string> = {};
    if (!values.displayName.trim()) nextFields.displayName = "กรุณากรอกชื่อที่แสดง";
    if (!values.legalName.trim()) nextFields.legalName = "กรุณากรอกชื่อจริง";
    if ((values.serviceMode === "gym" || values.serviceMode === "both") && !values.gymName.trim()) nextFields.gymName = "กรุณากรอกชื่อยิม";
    if (selectedTypes.length === 0) nextFields.trainingTypeIds = "เลือกประเภทการฝึกอย่างน้อยหนึ่งรายการ";
    if (!Number.isInteger(Number(values.yearsExperience)) || Number(values.yearsExperience) < 0) nextFields.yearsExperience = "กรอกจำนวนปีตั้งแต่ศูนย์ขึ้นไป";
    if (values.priceFrom !== "" && Number(values.priceFrom) <= 0) nextFields.priceFrom = "ค่าฝึกต้องมากกว่าศูนย์";
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      return;
    }

    setPending(true);
    setMessage("");
    setError("");
    setFields({});
    try {
      const saved = await authenticatedRequest<TrainerAccountProfile>("/v1/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: values.displayName.trim(), legalName: values.legalName.trim(), phone: values.phone.trim(),
          headline: values.headline.trim(), bio: values.bio.trim(), yearsExperience: Number(values.yearsExperience),
          serviceMode: values.serviceMode, gymName: values.serviceMode === "freelance" ? "" : values.gymName.trim(),
          priceFrom: values.priceFrom === "" ? null : Number(values.priceFrom), trainingTypeIds: selectedTypes,
        }),
      });
      onSaved(saved);
      setMessage("บันทึกข้อมูลเทรนเนอร์แล้ว");
    } catch (saveError) {
      if (saveError instanceof ApiError) setFields(saveError.fields);
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  const showGym = values.serviceMode === "gym" || values.serviceMode === "both";

  return (
    <section className="profile-section" aria-labelledby="trainer-details-title">
      <div className="profile-section__heading"><div><p className="label">ข้อมูลวิชาชีพ</p><h2 id="trainer-details-title">รายละเอียดเทรนเนอร์</h2></div><StatusBadge status={profile.trainer.approvalStatus} /></div>
      <form onSubmit={submit} noValidate>
        <div className="profile-form-grid">
          <div className="field"><label htmlFor="trainer-display-name">ชื่อที่แสดง</label><Input id="trainer-display-name" value={values.displayName} aria-invalid={Boolean(fields.displayName)} onChange={(event) => change("displayName", event.target.value)} />{fields.displayName && <small className="profile-field-error">{fields.displayName}</small>}</div>
          <div className="field"><label htmlFor="trainer-legal-name">ชื่อจริง</label><Input id="trainer-legal-name" value={values.legalName} aria-invalid={Boolean(fields.legalName)} onChange={(event) => change("legalName", event.target.value)} />{fields.legalName && <small className="profile-field-error">{fields.legalName}</small>}</div>
          <div className="field"><label htmlFor="trainer-email">อีเมล</label><Input className="profile-readonly" id="trainer-email" value={profile.user.email} readOnly /></div>
          <div className="field"><label htmlFor="trainer-phone">เบอร์โทรศัพท์</label><Input id="trainer-phone" value={values.phone} onChange={(event) => change("phone", event.target.value)} /></div>
          <div className="field field--full"><label htmlFor="trainer-headline">หัวข้อแนะนำตัว</label><Input id="trainer-headline" value={values.headline} onChange={(event) => change("headline", event.target.value)} /></div>
          <div className="field field--full"><label htmlFor="trainer-bio">เกี่ยวกับฉัน</label><Textarea id="trainer-bio" rows={3} value={values.bio} onChange={(event) => change("bio", event.target.value)} /></div>
          <div className="field"><label htmlFor="trainer-years">ประสบการณ์ (ปี)</label><Input id="trainer-years" type="number" min="0" step="1" value={values.yearsExperience} onChange={(event) => change("yearsExperience", event.target.value)} />{fields.yearsExperience && <small className="profile-field-error">{fields.yearsExperience}</small>}</div>
          <div className="field"><label htmlFor="trainer-service">รูปแบบการให้บริการ</label><NativeSelect className="profile-select" id="trainer-service" value={values.serviceMode} onChange={(event) => change("serviceMode", event.target.value)}><NativeSelectOption value="freelance">อิสระ</NativeSelectOption><NativeSelectOption value="gym">ประจำยิม</NativeSelectOption><NativeSelectOption value="both">อิสระและประจำยิม</NativeSelectOption></NativeSelect></div>
          {showGym && <div className="field"><label htmlFor="trainer-gym">ชื่อยิม</label><Input id="trainer-gym" required value={values.gymName} aria-invalid={Boolean(fields.gymName)} onChange={(event) => change("gymName", event.target.value)} />{fields.gymName && <small className="profile-field-error">{fields.gymName}</small>}</div>}
          <div className="field"><label htmlFor="trainer-price">ค่าฝึกเริ่มต้น (บาท)</label><Input id="trainer-price" type="number" min="0" step="0.01" value={values.priceFrom} onChange={(event) => change("priceFrom", event.target.value)} />{fields.priceFrom && <small className="profile-field-error">{fields.priceFrom}</small>}</div>
          <fieldset className="field field--full profile-training-types"><legend>ประเภทการฝึก</legend>{trainingTypes.map((type) => <label key={type.id}><input type="checkbox" checked={selectedTypes.includes(type.id)} onChange={() => toggleType(type.id)} /> {type.nameTh}</label>)}{typeError && <small className="profile-field-error" role="alert">{typeError}</small>}{fields.trainingTypeIds && <small className="profile-field-error">{fields.trainingTypeIds}</small>}</fieldset>
        </div>
        <div className="profile-readonly-block"><div><span>สถานะการตรวจ</span><StatusBadge status={profile.trainer.approvalStatus} /></div>{profile.trainer.approvalNote && <p><strong>หมายเหตุจากผู้ดูแลระบบ</strong><span>{profile.trainer.approvalNote}</span></p>}<div className="profile-certificates"><strong>ใบรับรอง</strong>{profile.trainer.certificates.length === 0 ? <p>ยังไม่มีใบรับรอง</p> : <ul>{profile.trainer.certificates.map((certificate) => <li key={certificate.id}><span><strong>{certificate.name}</strong><small>{certificate.issuer}{certificate.issuedYear ? ` · ${certificate.issuedYear}` : ""}</small></span><StatusBadge status={certificate.status} /></li>)}</ul>}</div></div>
        {error && <p className="profile-form-error" role="alert">{error}</p>}
        {message && <p className="profile-success" role="status">{message}</p>}
        <div className="profile-form-actions"><Button type="submit" disabled={pending || Boolean(typeError)}>{pending ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังบันทึก</> : <><Save aria-hidden="true" /> บันทึกข้อมูลเทรนเนอร์</>}</Button></div>
      </form>
    </section>
  );
}
