"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, BadgeCheck, ChevronDown, MapPin, Search, SlidersHorizontal } from "lucide-react";
import { AvailabilityPanel } from "@/components/availability-panel";
import { BookingStrip } from "@/components/booking-strip";
import { CredentialCard } from "@/components/credential-card";
import { DemoNotice } from "@/components/demo-notice";
import { formatMoney, initials } from "@/lib/format";
import type { AvailabilitySlot, Province, Trainer, TrainingType } from "@/lib/types";

type Props = {
  initialTrainers: Trainer[];
  provinces: Province[];
  trainingTypes: TrainingType[];
  isDemo: boolean;
  initialQuery?: string;
  initialProvince?: string;
  initialType?: string;
};

export function TrainerDiscovery({
  initialTrainers,
  provinces,
  trainingTypes,
  isDemo,
  initialQuery = "",
  initialProvince = "",
  initialType = "",
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [province, setProvince] = useState(initialProvince);
  const [trainingType, setTrainingType] = useState(initialType);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(initialTrainers[0]?.id ?? 0);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("th-TH");
    return initialTrainers.filter((trainer) => {
      const haystack = [
        trainer.displayName,
        trainer.headline,
        trainer.province.nameTh,
        ...trainer.trainingTypes.map((type) => type.nameTh),
      ].join(" ").toLocaleLowerCase("th-TH");
      const matchesQuery = !normalized || haystack.includes(normalized);
      const matchesProvince = !province || trainer.province.nameTh === province;
      const matchesType = !trainingType || trainer.trainingTypes.some((type) => type.slug === trainingType || type.nameTh === trainingType);
      const matchesVerified = !verifiedOnly || trainer.verification === "verified";
      return matchesQuery && matchesProvince && matchesType && matchesVerified;
    });
  }, [initialTrainers, province, query, trainingType, verifiedOnly]);

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
          เปรียบเทียบคุณสมบัติ และช่วงว่างก่อนส่งคำขอจอง
          เริ่มต้นในสกลนครและออกแบบข้อมูลให้ขยายได้ทั่วประเทศ
        </p>
      </section>

      {isDemo && <DemoNotice />}

      <div className="discovery-workbench">
        <aside className="discovery-controls" aria-labelledby="filter-title">
          <div className="workbench-title desktop-filter-title">
            <SlidersHorizontal aria-hidden="true" size={19} />
            <h2 id="filter-title">กรองเทรนเนอร์</h2>
          </div>
          <button
            className="mobile-filter-toggle"
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="trainer-filter-fields"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span><SlidersHorizontal aria-hidden="true" size={19} /> ตัวกรอง</span>
            <ChevronDown aria-hidden="true" className={filtersOpen ? "is-open" : ""} size={18} />
          </button>

          <div id="trainer-filter-fields" className={`filter-fields${filtersOpen ? " is-open" : ""}`}>
            <div className="field">
              <label htmlFor="trainer-query">ชื่อหรือความเชี่ยวชาญ</label>
              <div className="input-with-icon">
                <Search aria-hidden="true" size={17} />
                <input
                  id="trainer-query"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="เช่น เวทเทรนนิง"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="type-filter">ประเภทการฝึก</label>
              <select id="type-filter" value={trainingType} onChange={(event) => setTrainingType(event.target.value)}>
                <option value="">ทุกประเภท</option>
                {trainingTypes.map((type) => <option key={type.id} value={type.slug}>{type.nameTh}</option>)}
              </select>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} />
              <span>แสดงเฉพาะโปรไฟล์ที่ตรวจแล้ว</span>
            </label>
          </div>

          <div className="result-heading">
            <strong>{filtered.length} ผลลัพธ์</strong>
            <span>เลือกเพื่อดูหลักฐาน</span>
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
                  </span>
                  {trainer.verification === "verified" && <BadgeCheck className="verified-icon" aria-label="ตรวจคุณสมบัติแล้ว" size={19} />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="empty-state">
                <strong>ยังไม่พบเทรนเนอร์ที่ตรงครบทุกข้อ</strong>
                <p>ลองเปลี่ยนประเภทการฝึก หรือยกเลิกตัวกรองคุณสมบัติ</p>
              </div>
            )}
          </div>
        </aside>

        <div className="trainer-evidence">
          {selectedTrainer ? (
            <>
              <div className="trainer-portrait">
                {selectedTrainer.image ? (
                  <Image
                    src={selectedTrainer.image}
                    alt={`ภาพบุคคลสังเคราะห์ของ${selectedTrainer.displayName} ใช้เพื่อสาธิต`}
                    fill
                    priority
                    loading="eager"
                    fetchPriority="high"
                    sizes="(max-width: 900px) 100vw, 45vw"
                  />
                ) : <span>{initials(selectedTrainer.displayName)}</span>}
                <div className="portrait-stamp">ภาพสังเคราะห์ · สาธิต</div>
              </div>
              <CredentialCard trainer={selectedTrainer} />
              <div className="evidence-actions">
                <Link href={`/trainers/${selectedTrainer.slug}`}>
                  ดูโปรไฟล์เต็ม <ArrowUpRight aria-hidden="true" size={17} />
                </Link>
                <span>เริ่มต้น {formatMoney(selectedTrainer.priceFrom)} / ครั้ง</span>
              </div>
            </>
          ) : (
            <div className="empty-evidence">
              <p className="label">ผลการค้นหา</p>
              <h2>ปรับตัวกรองเพื่อดูโปรไฟล์</h2>
            </div>
          )}
        </div>

        <div className="schedule-zone">
          {selectedTrainer ? (
            <AvailabilityPanel trainer={selectedTrainer} selectedSlot={selectedSlot} onSelectSlot={setSelectedSlot} />
          ) : (
            <div className="empty-evidence"><h2>ยังไม่มีตารางเวลา</h2></div>
          )}
        </div>
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
