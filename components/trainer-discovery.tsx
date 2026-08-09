"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, BadgeCheck, Search } from "lucide-react";
import { AvailabilityPanel } from "@/components/availability-panel";
import { BookingStrip } from "@/components/booking-strip";
import { CredentialCard } from "@/components/credential-card";
import { DemoNotice } from "@/components/demo-notice";
import { DisclosureSection } from "@/components/disclosure-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatMoney, initials } from "@/lib/format";
import type { AvailabilitySlot, Trainer, TrainingType } from "@/lib/types";

type Props = {
  initialTrainers: Trainer[];
  trainingTypes: TrainingType[];
  isDemo: boolean;
  initialQuery?: string;
  initialType?: string;
};

export function TrainerDiscovery({
  initialTrainers,
  trainingTypes,
  isDemo,
  initialQuery = "",
  initialType = "",
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [trainingType, setTrainingType] = useState(initialType);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(initialTrainers[0]?.id ?? 0);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("th-TH");
    return initialTrainers.filter((trainer) => {
      const haystack = [
        trainer.displayName,
        trainer.headline,
        ...trainer.trainingTypes.map((type) => type.nameTh),
      ].join(" ").toLocaleLowerCase("th-TH");
      const matchesQuery = !normalized || haystack.includes(normalized);
      const matchesType = !trainingType || trainer.trainingTypes.some((type) => type.slug === trainingType || type.nameTh === trainingType);
      const matchesVerified = !verifiedOnly || trainer.verification === "verified";
      return matchesQuery && matchesType && matchesVerified;
    });
  }, [initialTrainers, query, trainingType, verifiedOnly]);

  const selectedTrainer = filtered.find((trainer) => trainer.id === selectedId) ?? filtered[0] ?? null;

  function selectTrainer(trainer: Trainer) {
    setSelectedId(trainer.id);
    setSelectedSlot(null);
  }

  return (
    <>
      <section className="discovery-intro">
        <div>
          <nav className="workflow-progress" aria-label="ขั้นตอนการจอง">
            <span aria-current="step">ค้นหาและตรวจสอบ</span>
            <span>เลือกเวลา</span>
            <span>ส่งคำขอ</span>
          </nav>
          <h1>หาเทรนเนอร์ที่<br />พร้อมฝึกจริง</h1>
        </div>
        <p>
          เปรียบเทียบความเชี่ยวชาญ รูปแบบการให้บริการ ราคา และช่วงว่างก่อนส่งคำขอจอง
        </p>
      </section>

      {isDemo && <DemoNotice />}

      <div className="discovery-guided-layout">
        <section className="discovery-search" aria-labelledby="discovery-search-title">
          <div className="workbench-title">
            <Search aria-hidden="true" size={19} />
            <h2 id="discovery-search-title">ค้นหาเทรนเนอร์</h2>
          </div>
          <div className="field discovery-query-field">
            <Label htmlFor="trainer-query">ชื่อหรือความเชี่ยวชาญ</Label>
            <div className="input-with-icon">
              <Search aria-hidden="true" size={17} />
              <Input
                id="trainer-query"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedSlot(null);
                }}
                placeholder="เช่น เวทเทรนนิง"
              />
            </div>
          </div>
          <DisclosureSection
            title="ตัวกรองเพิ่มเติม"
            summary={trainingType || verifiedOnly ? "กำลังใช้ตัวกรอง" : "ประเภทการฝึกและสถานะการตรวจ"}
            className="discovery-filter-disclosure"
          >
            <div className="guided-filter-grid">
              <div className="field">
                <Label htmlFor="type-filter">ประเภทการฝึก</Label>
                <NativeSelect id="type-filter" value={trainingType} onChange={(event) => {
                  setTrainingType(event.target.value);
                  setSelectedSlot(null);
                }}>
                  <NativeSelectOption value="">ทุกประเภท</NativeSelectOption>
                  {trainingTypes.map((type) => <NativeSelectOption key={type.id} value={type.slug}>{type.nameTh}</NativeSelectOption>)}
                </NativeSelect>
              </div>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={verifiedOnly} onChange={(event) => {
                setVerifiedOnly(event.target.checked);
                setSelectedSlot(null);
              }} />
              <span>แสดงเฉพาะโปรไฟล์ที่ตรวจแล้ว</span>
            </label>
          </DisclosureSection>
        </section>

        <section
          className="trainer-results"
          aria-label={`ผลการค้นหาเทรนเนอร์ ${filtered.length} รายการ`}
        >
          <div className="result-heading" aria-live="polite">
            <strong>{filtered.length} ผลลัพธ์</strong>
            <span>เลือกเพื่อดูข้อมูลและตารางว่าง</span>
          </div>
          <div className="trainer-result-list">
            {filtered.map((trainer) => {
              const active = trainer.id === selectedTrainer?.id;
              return (
                <button
                  className={`trainer-result${active ? " is-active" : ""}`}
                  type="button"
                  key={trainer.id}
                  aria-pressed={active}
                  aria-label={`เลือก ${trainer.displayName}${trainer.verification === "verified" ? " ตรวจคุณสมบัติแล้ว" : ""}`}
                  onClick={() => selectTrainer(trainer)}
                >
                  <span className="result-avatar">
                    {trainer.image ? (
                      <Image
                        src={trainer.image}
                        alt=""
                        width={52}
                        height={52}
                        sizes="52px"
                        loading={active ? "eager" : "lazy"}
                        fetchPriority={active ? "high" : "auto"}
                      />
                    ) : <span>{initials(trainer.displayName)}</span>}
                  </span>
                  <span className="result-copy">
                    <strong>{trainer.displayName}</strong>
                    <span>{trainer.trainingTypes[0]?.nameTh ?? "การฝึกส่วนบุคคล"}</span>
                  </span>
                  {trainer.verification === "verified" && <BadgeCheck className="verified-icon" aria-label="ตรวจคุณสมบัติแล้ว" size={19} />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="empty-state">
                <strong>ยังไม่พบเทรนเนอร์ที่ตรงครบทุกข้อ</strong>
                <p>ลองเปลี่ยนคำค้น ประเภทการฝึก หรือยกเลิกตัวกรองคุณสมบัติ</p>
              </div>
            )}
          </div>
        </section>

        <section className="selected-trainer-summary" aria-label="ข้อมูลเทรนเนอร์ที่เลือก">
          {selectedTrainer ? (
            <>
              <div className="selected-trainer-overview">
                <div className="trainer-portrait">
                  {selectedTrainer.image ? (
                    <Image
                      src={selectedTrainer.image}
                      alt={selectedTrainer.demo
                        ? `ภาพสังเคราะห์ของ${selectedTrainer.displayName} ใช้เพื่อสาธิต`
                        : `ภาพบุคคลของ${selectedTrainer.displayName}`}
                      fill
                      priority
                      loading="eager"
                      fetchPriority="high"
                      sizes="(max-width: 900px) 100vw, 40vw"
                    />
                  ) : <span>{initials(selectedTrainer.displayName)}</span>}
                  {selectedTrainer.demo && <div className="portrait-stamp">ภาพสังเคราะห์ · สาธิต</div>}
                </div>
                <div className="selected-trainer-copy">
                  <p className="label">เทรนเนอร์ที่เลือก</p>
                  <h2>{selectedTrainer.displayName}</h2>
                  <p>{selectedTrainer.headline}</p>
                  <div className="selected-trainer-facts">
                    <span>{selectedTrainer.trainingTypes.map((type) => type.nameTh).join(" · ")}</span>
                    {selectedTrainer.verification === "verified" && <span><BadgeCheck aria-hidden="true" size={16} /> ตรวจคุณสมบัติแล้ว</span>}
                  </div>
                  <div className="evidence-actions">
                    <Link href={`/trainers/${selectedTrainer.slug}`}>
                      ดูโปรไฟล์เต็ม <ArrowUpRight aria-hidden="true" size={17} />
                    </Link>
                    <span>{selectedTrainer.priceFrom == null
                      ? "รอยืนยันราคา"
                      : `เริ่มต้น ${formatMoney(selectedTrainer.priceFrom)} / ครั้ง`}</span>
                  </div>
                </div>
              </div>
              <DisclosureSection
                title="หลักฐานและใบรับรอง"
                summary={`${selectedTrainer.certificates.length} รายการ · ประสบการณ์ ${selectedTrainer.yearsExperience} ปี`}
                className="credential-disclosure"
              >
                <CredentialCard trainer={selectedTrainer} />
              </DisclosureSection>
              <AvailabilityPanel trainer={selectedTrainer} selectedSlot={selectedSlot} onSelectSlot={setSelectedSlot} />
            </>
          ) : (
            <div className="empty-evidence">
              <p className="label">ผลการค้นหา</p>
              <h2>ปรับตัวกรองเพื่อดูโปรไฟล์</h2>
            </div>
          )}
        </section>
      </div>

      <section className="process-rule" aria-labelledby="process-title">
        <div>
          <h2 id="process-title">หลักฐานชัด สถานะต่อเนื่อง</h2>
        </div>
        <ol>
          <li><span>01</span><strong>ส่งคำขอ</strong><p>เลือกโปรไฟล์และช่วงเวลาที่ว่าง</p></li>
          <li><span>02</span><strong>เทรนเนอร์ตอบรับ</strong><p>ยืนยันเวลา สถานที่ และราคา</p></li>
          <li><span>03</span><strong>อัปโหลดสลิป</strong><p>แอดมินตรวจหลักฐานด้วยตนเอง</p></li>
          <li><span>04</span><strong>เริ่มฝึก</strong><p>นัดหมาย แชต และรีวิวในระบบเดียว</p></li>
        </ol>
      </section>

      <BookingStrip trainer={selectedTrainer} slot={selectedSlot} />
    </>
  );
}
