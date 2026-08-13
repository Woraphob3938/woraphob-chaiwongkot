"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest } from "@/lib/api";
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
    serviceMode: profile.trainer.serviceMode,
    gymName: profile.trainer.gymName ?? "",
    priceFrom: profile.trainer.priceFrom?.toString() ?? "",
    monthlyPrice: profile.trainer.monthlyPrice?.toString() ?? "",
    monthlySessionCount: profile.trainer.monthlySessionCount?.toString() ?? "",
    trainingTypeIds: [...profile.trainer.trainingTypeIds].sort((a, b) => a - b),
  };
}

export function TrainerAccountForm({ profile, onSaved, onDirtyChange }: TrainerAccountFormProps) {
  const saved = useRef(snapshot(profile));
  const [values, setValues] = useState(saved.current);
  const [selectedTypes, setSelectedTypes] = useState<number[]>(saved.current.trainingTypeIds);
  const [trainingTypes, setTrainingTypes] = useState<TrainingType[]>([]);
  const [typesPending, setTypesPending] = useState(true);
  const [typeError, setTypeError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    loadTrainingTypes();
  }, [loadTrainingTypes]);

  useEffect(() => {
    const dirty = JSON.stringify({ ...values, trainingTypeIds: selectedTypes }) !== JSON.stringify({
      ...saved.current,
      trainingTypeIds: saved.current.trainingTypeIds,
    });
    onDirtyChange?.(dirty);
  }, [values, selectedTypes, onDirtyChange]);

  function change(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: "" }));
  }

  function toggleType(typeId: number) {
    setSelectedTypes((current) => current.includes(typeId) ? current.filter((id) => id !== typeId) : [...current, typeId].sort((a, b) => a - b));
    setFields((current) => ({ ...current, trainingTypeIds: "" }));
  }

  function resetSaved() {
    setValues(saved.current);
    setSelectedTypes(saved.current.trainingTypeIds);
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
    if ((values.serviceMode === "gym" || values.serviceMode === "both") && !values.gymName.trim()) nextFields.gymName = "กรุณากรอกชื่อยิม";
    if (!typeError && selectedTypes.length === 0) nextFields.trainingTypeIds = "เลือกประเภทการฝึกอย่างน้อยหนึ่งรายการ";
    if (!Number.isInteger(Number(values.yearsExperience)) || Number(values.yearsExperience) < 0) nextFields.yearsExperience = "กรอกจำนวนปีตั้งแต่ศูนย์ขึ้นไป";
    if (values.priceFrom !== "" && Number(values.priceFrom) <= 0) nextFields.priceFrom = "ค่าฝึกต้องมากกว่าศูนย์";
    if ((values.monthlyPrice === "") !== (values.monthlySessionCount === "")) {
      if (values.monthlyPrice === "") nextFields.monthlyPrice = "กรอกราคาแพ็กเกจ 30 วัน";
      if (values.monthlySessionCount === "") nextFields.monthlySessionCount = "กรอกจำนวนครั้งในแพ็กเกจ";
    }
    if (values.monthlyPrice !== "" && Number(values.monthlyPrice) <= 0) nextFields.monthlyPrice = "ราคาแพ็กเกจต้องมากกว่าศูนย์";
    if (values.monthlySessionCount !== "" && (!Number.isInteger(Number(values.monthlySessionCount)) || Number(values.monthlySessionCount) < 2 || Number(values.monthlySessionCount) > 30)) {
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
        gymName: "trainer-gym",
        trainingTypeIds: "trainer-training-types",
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
          monthlyPrice: values.monthlyPrice === "" ? null : Number(values.monthlyPrice),
          monthlySessionCount: values.monthlySessionCount === "" ? null : Number(values.monthlySessionCount),
        }),
      });
      saved.current = snapshot(result);
      setValues(saved.current);
      setSelectedTypes(saved.current.trainingTypeIds);
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
          gymName: "trainer-gym",
          trainingTypeIds: "trainer-training-types",
        };
        focusFirstInvalid(Object.keys(saveError.fields).map((key) => idByField[key]).filter(Boolean));
      }
    } finally {
      setPending(false);
    }
  }

  const showGym = values.serviceMode === "gym" || values.serviceMode === "both";
  const dirty = JSON.stringify({ ...values, trainingTypeIds: selectedTypes }) !== JSON.stringify({
    ...saved.current,
    trainingTypeIds: saved.current.trainingTypeIds,
  });

  return (
    <section className="profile-section" aria-labelledby="trainer-details-title">
      <div className="profile-section__heading">
        <h2 id="trainer-details-title">รายละเอียดเทรนเนอร์</h2>
        <p>ชื่อที่แสดง ราคา และประเภทฝึกขึ้นหน้าร้านหลังบันทึก สถานะตรวจและใบรับรองแก้ได้เฉพาะผู้ดูแลระบบ</p>
      </div>
      <form onSubmit={submit} noValidate>
        <div className="profile-group">
          <h3>ราคา</h3>
          <p className="profile-group__hint">กรอกราคาแพ็กเกจ 30 วันและจำนวนครั้งคู่กัน หรือเว้นว่างทั้งคู่</p>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="trainer-price">ค่าฝึกเริ่มต้น (บาท)</label>
              <Input id="trainer-price" type="number" min="0" step="0.01" inputMode="decimal" value={values.priceFrom} aria-invalid={Boolean(fields.priceFrom)} aria-describedby={fieldDescribedBy("trainer-price", fields.priceFrom)} onChange={(event) => change("priceFrom", event.target.value)} />
              {fields.priceFrom && <small className="profile-field-error" id="trainer-price-error">{fields.priceFrom}</small>}
            </div>
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
        </div>

        <div className="profile-group">
          <h3>ตัวตน</h3>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="trainer-display-name">ชื่อที่แสดง</label>
              <Input id="trainer-display-name" value={values.displayName} aria-required="true" aria-invalid={Boolean(fields.displayName)} aria-describedby={fieldDescribedBy("trainer-display-name", fields.displayName)} onChange={(event) => change("displayName", event.target.value)} />
              {fields.displayName && <small className="profile-field-error" id="trainer-display-name-error">{fields.displayName}</small>}
            </div>
            <div className="field">
              <label htmlFor="trainer-legal-name">ชื่อจริง</label>
              <Input id="trainer-legal-name" value={values.legalName} aria-required="true" aria-invalid={Boolean(fields.legalName)} aria-describedby={fieldDescribedBy("trainer-legal-name", fields.legalName)} onChange={(event) => change("legalName", event.target.value)} />
              {fields.legalName && <small className="profile-field-error" id="trainer-legal-name-error">{fields.legalName}</small>}
            </div>
            <div className="field">
              <span id="trainer-email-label">อีเมล</span>
              <p className="profile-static-value" aria-labelledby="trainer-email-label">{profile.user.email}</p>
              <small>ใช้อีเมลนี้เข้าสู่ระบบ เปลี่ยนไม่ได้จากหน้านี้</small>
            </div>
            <div className="field">
              <label htmlFor="trainer-phone">เบอร์โทรศัพท์</label>
              <Input id="trainer-phone" inputMode="tel" value={values.phone} aria-invalid={Boolean(fields.phone)} aria-describedby={fieldDescribedBy("trainer-phone", fields.phone)} onChange={(event) => change("phone", event.target.value)} />
              {fields.phone && <small className="profile-field-error" id="trainer-phone-error">{fields.phone}</small>}
            </div>
            <div className="field field--full">
              <label htmlFor="trainer-headline">ประโยคแนะนำตัวบนหน้าร้าน</label>
              <Input id="trainer-headline" value={values.headline} onChange={(event) => change("headline", event.target.value)} />
            </div>
            <div className="field field--full">
              <label htmlFor="trainer-bio">เกี่ยวกับฉัน</label>
              <Textarea id="trainer-bio" rows={3} value={values.bio} onChange={(event) => change("bio", event.target.value)} />
            </div>
          </div>
        </div>

        <div className="profile-group">
          <h3>การให้บริการ</h3>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="trainer-years">ประสบการณ์ (ปี)</label>
              <Input id="trainer-years" type="number" min="0" step="1" inputMode="numeric" value={values.yearsExperience} aria-invalid={Boolean(fields.yearsExperience)} aria-describedby={fieldDescribedBy("trainer-years", fields.yearsExperience)} onChange={(event) => change("yearsExperience", event.target.value)} />
              {fields.yearsExperience && <small className="profile-field-error" id="trainer-years-error">{fields.yearsExperience}</small>}
            </div>
            <div className="field">
              <label htmlFor="trainer-service">รูปแบบการให้บริการ</label>
              <NativeSelect className="profile-select" id="trainer-service" value={values.serviceMode} onChange={(event) => change("serviceMode", event.target.value)}>
                <NativeSelectOption value="freelance">อิสระ</NativeSelectOption>
                <NativeSelectOption value="gym">ประจำยิม</NativeSelectOption>
                <NativeSelectOption value="both">อิสระและประจำยิม</NativeSelectOption>
              </NativeSelect>
            </div>
            {showGym && (
              <div className="field">
                <label htmlFor="trainer-gym">ชื่อยิม</label>
                <Input id="trainer-gym" required value={values.gymName} aria-required="true" aria-invalid={Boolean(fields.gymName)} aria-describedby={fieldDescribedBy("trainer-gym", fields.gymName)} onChange={(event) => change("gymName", event.target.value)} />
                {fields.gymName && <small className="profile-field-error" id="trainer-gym-error">{fields.gymName}</small>}
              </div>
            )}
            <fieldset className="field field--full profile-training-types" id="trainer-training-types" aria-describedby={fieldDescribedBy("trainer-training-types", fields.trainingTypeIds || typeError)}>
              <legend>ประเภทการฝึก</legend>
              {typesPending && <p>กำลังโหลดประเภทการฝึก</p>}
              {!typesPending && trainingTypes.map((type) => (
                <label key={type.id}>
                  <input type="checkbox" checked={selectedTypes.includes(type.id)} onChange={() => toggleType(type.id)} /> {type.nameTh}
                </label>
              ))}
              {typeError && (
                <div className="profile-inline-error">
                  <small className="profile-field-error" id="trainer-training-types-error" role="alert">{typeError}</small>
                  <button className="button" type="button" onClick={loadTrainingTypes}>ลองโหลดประเภทการฝึกใหม่</button>
                </div>
              )}
              {fields.trainingTypeIds && <small className="profile-field-error" id="trainer-training-types-error">{fields.trainingTypeIds}</small>}
            </fieldset>
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
              <dt>ใบรับรอง</dt>
              <dd>
                {profile.trainer.certificates.length === 0
                  ? <p>ยังไม่มีใบรับรอง ผู้ดูแลระบบเป็นผู้เพิ่มและตรวจเอกสาร ไม่สามารถอัปโหลดจากหน้านี้</p>
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
              </dd>
            </div>
          </dl>
        </div>

        {error && <p className="profile-form-error" role="alert">{error}</p>}
        {message && <p className="profile-success" role="status">{message}</p>}
        <div className="profile-form-actions">
          {dirty && <button className="button" type="button" disabled={pending} onClick={resetSaved}>คืนค่าที่บันทึกไว้</button>}
          <button className="button button--accent" type="submit" disabled={pending}>
            {pending ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังบันทึก</> : <><Save aria-hidden="true" /> บันทึกข้อมูลเทรนเนอร์</>}
          </button>
        </div>
      </form>
    </section>
  );
}
