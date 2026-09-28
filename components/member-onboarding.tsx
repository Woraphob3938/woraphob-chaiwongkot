"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { profileFieldErrors, validateBirthDate } from "@/components/member-profile-form";
import { authenticatedRequest } from "@/lib/api";
import { fieldDescribedBy, focusFirstInvalid } from "@/lib/profile-form";
import { leaveExpiredSession } from "@/lib/session";
import type { MemberAccountProfile } from "@/lib/types";

const STEPS = [
  { id: "about", title: "เกี่ยวกับคุณ", hint: "ชื่อและช่องทางติดต่อ", fields: ["firstName", "lastName", "phone", "birthDate"] },
  { id: "goal", title: "เป้าหมายการฝึก", hint: "ช่วยให้เทรนเนอร์เตรียมตัว", fields: ["experienceLevel", "weight", "height", "fitnessGoal"] },
] as const;

const fieldIds: Record<string, string> = {
  firstName: "welcome-first-name",
  lastName: "welcome-last-name",
  phone: "welcome-phone",
  birthDate: "welcome-birth-date",
  experienceLevel: "welcome-experience",
  weight: "welcome-weight",
  height: "welcome-height",
  fitnessGoal: "welcome-goal",
};

const experienceOptions = [
  { value: "beginner", label: "เริ่มต้น", hint: "เพิ่งเริ่มหรือห่างหายไปนาน" },
  { value: "intermediate", label: "มีประสบการณ์", hint: "ออกกำลังกายเป็นครั้งคราว" },
  { value: "advanced", label: "ฝึกสม่ำเสมอ", hint: "ฝึกเป็นประจำทุกสัปดาห์" },
] as const;

const goalSuggestions = ["ลดน้ำหนัก", "สร้างกล้ามเนื้อ", "เพิ่มความแข็งแรง", "ฟื้นฟูร่างกาย", "เตรียมแข่งกีฬา"];

type Values = {
  firstName: string;
  lastName: string;
  phone: string;
  birthDate: string;
  experienceLevel: string;
  weight: string;
  height: string;
  fitnessGoal: string;
};

const empty: Values = { firstName: "", lastName: "", phone: "", birthDate: "", experienceLevel: "", weight: "", height: "", fitnessGoal: "" };

/** Only an internal path may follow the welcome, never another site. */
function safeNext(value: string | null | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/trainers";
}

/**
 * Right after a member registers: two short steps that fill the member profile
 * a trainer reads before the first session. Every field can be skipped, and the
 * same record stays editable later on the profile page.
 */
export function MemberOnboarding({ next }: { next?: string | null }) {
  const router = useRouter();
  const destination = safeNext(next);
  const [values, setValues] = useState<Values>(empty);
  const [displayName, setDisplayName] = useState("");
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    authenticatedRequest<MemberAccountProfile>("/v1/profile")
      .then((profile) => {
        if (!active) return;
        if (profile.role !== "member") {
          router.replace("/");
          return;
        }
        const member = profile.member as MemberAccountProfile["member"] & { birthDate?: string | null };
        setDisplayName(profile.user.displayName);
        setValues({
          firstName: member.nameFromDisplayName ? "" : member.firstName,
          lastName: member.lastName,
          phone: member.phone,
          birthDate: member.birthDate ?? "",
          experienceLevel: member.experienceLevel,
          weight: member.weight?.toString() ?? "",
          height: member.height?.toString() ?? "",
          fitnessGoal: member.fitnessGoal,
        });
      })
      .catch((loadError: unknown) => {
        if (!active || leaveExpiredSession(loadError, router.push)) return;
        setError("โหลดข้อมูลบัญชีไม่สำเร็จ กรอกข้อมูลได้ตามปกติ");
      })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [router]);

  function change(name: keyof Values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: "" }));
  }

  function addGoal(goal: string) {
    const current = values.fitnessGoal.trim();
    if (current.includes(goal)) return;
    change("fitnessGoal", current ? `${current}, ${goal}` : goal);
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!values.firstName.trim()) errors.firstName = "กรุณากรอกชื่อ";
    if (!values.lastName.trim()) errors.lastName = "กรุณากรอกนามสกุล";
    const birthDateError = validateBirthDate(values.birthDate);
    if (birthDateError) errors.birthDate = birthDateError;
    if (values.weight !== "" && Number(values.weight) <= 0) errors.weight = "น้ำหนักต้องมากกว่าศูนย์";
    if (values.height !== "" && Number(values.height) <= 0) errors.height = "ส่วนสูงต้องมากกว่าศูนย์";
    return errors;
  }

  function stepOf(key: string) {
    return STEPS.findIndex((definition) => (definition.fields as readonly string[]).includes(key));
  }

  function showErrors(errors: Record<string, string>) {
    setFields(errors);
    const keys = Object.keys(errors);
    if (keys.length === 0) return;
    setStep(Math.max(0, Math.min(...keys.map(stepOf))));
    window.setTimeout(() => focusFirstInvalid(keys.map((key) => fieldIds[key]).filter(Boolean)), 0);
  }

  function nextStep() {
    const stepFields = STEPS[step].fields as readonly string[];
    const errors = Object.fromEntries(Object.entries(validate()).filter(([key]) => stepFields.includes(key)));
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }
    setStep(step + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (step < STEPS.length - 1) {
      nextStep();
      return;
    }
    // Only the save button saves. The click on "ถัดไป" that just opened this
    // step can still reach the form as a submit, and must not end the welcome.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter && submitter.getAttribute("data-action") !== "save") return;
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }
    setPending(true);
    setError("");
    try {
      await authenticatedRequest<MemberAccountProfile>("/v1/profile", {
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
      });
      router.push(destination);
    } catch (saveError) {
      if (leaveExpiredSession(saveError, router.push)) return;
      showErrors(profileFieldErrors(saveError));
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลไม่สำเร็จ");
      setPending(false);
    }
  }

  function fieldError(key: string) {
    return fields[key] ? <small className="profile-field-error" id={`${fieldIds[key]}-error`}>{fields[key]}</small> : null;
  }

  return (
    <>
      <section className="form-page-heading apply-page-heading">
        <h1>ยินดีต้อนรับ{displayName ? ` ${displayName}` : ""}</h1>
        <p>กรอกข้อมูลอีก 2 ขั้นสั้น ๆ เทรนเนอร์จะเห็นเป้าหมายของคุณก่อนเริ่มฝึก ข้ามไปก่อนแล้วมาแก้ภายหลังที่หน้าโปรไฟล์ก็ได้</p>
      </section>

      <form className="trainer-apply-form apply-wizard member-welcome" aria-label="แบบฟอร์มข้อมูลสมาชิก" onSubmit={submit} noValidate aria-busy={pending || !ready}>
        <nav className="apply-steps" aria-label="ขั้นตอนการกรอกข้อมูล">
          <p className="apply-steps__count" aria-hidden="true">ขั้นที่ {step + 1} จาก {STEPS.length}</p>
          <ol>
            {STEPS.map((definition, index) => {
              const errorCount = definition.fields.filter((key) => Boolean(fields[key])).length;
              const done = index < step && errorCount === 0;
              return (
                <li key={definition.id}>
                  <button
                    type="button"
                    className={`apply-steps__item${index === step ? " is-current" : ""}${done ? " is-done" : ""}${errorCount ? " has-errors" : ""}`}
                    aria-current={index === step ? "step" : undefined}
                    onClick={() => (index <= step ? setStep(index) : nextStep())}
                  >
                    <span className="apply-steps__marker" aria-hidden="true">{errorCount ? "!" : done ? <Check size={14} strokeWidth={3} /> : index + 1}</span>
                    <span className="apply-steps__text">
                      <strong>{definition.title}</strong>
                      <small>{errorCount ? `ต้องแก้ ${errorCount} ช่อง` : definition.hint}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="apply-panel">
          <section className={`apply-step${step === 0 ? " is-active" : ""}`} aria-labelledby="welcome-step-about">
            <header className="apply-step__head"><h2 id="welcome-step-about">เกี่ยวกับคุณ</h2></header>
            <div className="apply-grid">
              <div className="field">
                <label htmlFor="welcome-first-name">ชื่อ</label>
                <Input id="welcome-first-name" autoComplete="given-name" value={values.firstName} aria-required="true" aria-invalid={Boolean(fields.firstName)} aria-describedby={fieldDescribedBy("welcome-first-name", fields.firstName)} onChange={(event) => change("firstName", event.target.value)} />
                {fieldError("firstName")}
              </div>
              <div className="field">
                <label htmlFor="welcome-last-name">นามสกุล</label>
                <Input id="welcome-last-name" autoComplete="family-name" value={values.lastName} aria-required="true" aria-invalid={Boolean(fields.lastName)} aria-describedby={fieldDescribedBy("welcome-last-name", fields.lastName)} onChange={(event) => change("lastName", event.target.value)} />
                {fieldError("lastName")}
              </div>
              <div className="field">
                <label htmlFor="welcome-phone">เบอร์โทรศัพท์ <span className="field-optional">ไม่บังคับ</span></label>
                <Input id="welcome-phone" type="tel" inputMode="tel" autoComplete="tel" value={values.phone} aria-describedby="welcome-phone-hint" onChange={(event) => change("phone", event.target.value)} />
                <small id="welcome-phone-hint">ให้เทรนเนอร์ติดต่อได้เมื่อจำเป็น</small>
              </div>
              <div className="field">
                <label htmlFor="welcome-birth-date">วันเกิด <span className="field-optional">ไม่บังคับ</span></label>
                <Input id="welcome-birth-date" type="date" value={values.birthDate} aria-invalid={Boolean(fields.birthDate)} aria-describedby={fieldDescribedBy("welcome-birth-date", fields.birthDate)} onChange={(event) => change("birthDate", event.target.value)} />
                {fieldError("birthDate")}
              </div>
            </div>
          </section>

          <section className={`apply-step${step === 1 ? " is-active" : ""}`} aria-labelledby="welcome-step-goal">
            <header className="apply-step__head"><h2 id="welcome-step-goal">เป้าหมายการฝึก</h2></header>
            <fieldset className="field apply-service" id="welcome-experience">
              <legend>ระดับประสบการณ์ <span className="field-optional">ไม่บังคับ</span></legend>
              <div className="apply-service__options member-welcome__levels">
                {experienceOptions.map((option) => (
                  <label key={option.value} className={`apply-option${values.experienceLevel === option.value ? " is-selected" : ""}`}>
                    <input type="radio" name="welcome-experience" value={option.value} checked={values.experienceLevel === option.value} onChange={() => change("experienceLevel", option.value)} />
                    <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="apply-grid">
              <div className="field">
                <label htmlFor="welcome-weight">น้ำหนัก (กก.) <span className="field-optional">ไม่บังคับ</span></label>
                <Input id="welcome-weight" type="number" min="0" step="0.1" inputMode="decimal" value={values.weight} aria-invalid={Boolean(fields.weight)} aria-describedby={fieldDescribedBy("welcome-weight", fields.weight)} onChange={(event) => change("weight", event.target.value)} />
                {fieldError("weight")}
              </div>
              <div className="field">
                <label htmlFor="welcome-height">ส่วนสูง (ซม.) <span className="field-optional">ไม่บังคับ</span></label>
                <Input id="welcome-height" type="number" min="0" step="0.1" inputMode="decimal" value={values.height} aria-invalid={Boolean(fields.height)} aria-describedby={fieldDescribedBy("welcome-height", fields.height)} onChange={(event) => change("height", event.target.value)} />
                {fieldError("height")}
              </div>
              <div className="field field--full">
                <label htmlFor="welcome-goal">เป้าหมายการออกกำลังกาย <span className="field-optional">ไม่บังคับ</span></label>
                <div className="apply-chips member-welcome__goals" aria-label="เป้าหมายยอดนิยม">
                  {goalSuggestions.map((goal) => (
                    <button key={goal} type="button" className={`apply-chip${values.fitnessGoal.includes(goal) ? " is-selected" : ""}`} onClick={() => addGoal(goal)}>
                      {values.fitnessGoal.includes(goal) && <Check aria-hidden="true" size={14} strokeWidth={3} />}{goal}
                    </button>
                  ))}
                </div>
                <Textarea id="welcome-goal" rows={3} value={values.fitnessGoal} placeholder="เช่น ลดไขมัน 5 กก. ใน 3 เดือน หรือ เริ่มเล่นเวทอย่างถูกท่า" onChange={(event) => change("fitnessGoal", event.target.value)} />
              </div>
            </div>
          </section>
        </div>

        <div className="apply-footer">
          <div className="form-message-slot" aria-live="polite">
            {error && <p className="profile-form-error" role="alert">{error}</p>}
          </div>
          <div className="apply-footer__row">
            <div className="apply-footer__secondary">
              <Link className="button button--ghost" href={destination}>ข้ามไปก่อน</Link>
            </div>
            <div className="apply-footer__primary">
              {step > 0 && (
                <button className="button" type="button" onClick={() => setStep(step - 1)}>
                  <ArrowLeft aria-hidden="true" size={16} /> ก่อนหน้า
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button key="next" className="button button--accent" type="button" onClick={nextStep} disabled={!ready}>
                  ถัดไป <ArrowRight aria-hidden="true" size={16} />
                </button>
              ) : (
                <button key="save" data-action="save" className="button button--accent" type="submit" disabled={pending || !ready}>
                  {pending ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังบันทึก</> : <>บันทึกและเริ่มหาเทรนเนอร์</>}
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
