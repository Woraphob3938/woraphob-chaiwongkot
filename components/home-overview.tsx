import Link from "next/link";
import { TrainerPreviewCard } from "@/components/trainer-preview-card";
import { formatTrainingTypeName } from "@/lib/format";
import type { Trainer, TrainingType } from "@/lib/types";

type HomeOverviewProps = {
  trainers: Trainer[];
  trainingTypes: TrainingType[];
};

const journeySteps = [
  {
    title: "ค้นหาเทรนเนอร์",
    description: "เลือกจากประเภทการฝึก รูปแบบบริการ ราคา และข้อมูลที่เทรนเนอร์ระบุ",
  },
  {
    title: "ตรวจคุณสมบัติ",
    description: "ดูสถานะการตรวจ ใบรับรอง ประสบการณ์ และช่วงเวลาที่เปิดให้จอง",
  },
  {
    title: "เลือกเวลา",
    description: "เลือกช่วงเวลาว่าง ยืนยันการจอง แล้วระบบจะล็อกเวลาไว้ 10 นาที",
  },
  {
    title: "ยืนยันการชำระ",
    description: "อัปโหลดสลิปภายในเวลาที่กำหนด แล้วรอผู้ตรวจตามรูปแบบบริการ",
  },
  {
    title: "ฝึกและรีวิว",
    description: "เข้าฝึกตามนัดและเขียนรีวิวหลังจบการฝึก",
  },
] as const;

export function HomeOverview({ trainers, trainingTypes }: HomeOverviewProps) {
  const featuredTrainers = trainers.slice(0, 4);
  const priorityTrainerId = featuredTrainers.find((trainer) => trainer.image)?.id;

  return (
    <div className="home-overview">
      <section className="home-training-types" aria-labelledby="training-goals-title">
        <header className="home-section-heading">
          <h1 id="training-goals-title">เลือกจากเป้าหมายการฝึก</h1>
          <p>เริ่มจากประเภทที่สนใจ แล้วปรับราคาและเวลาในหน้าค้นหา</p>
        </header>
        {trainingTypes.length > 0 ? (
          <ul className="home-training-types__list" aria-label="ประเภทการฝึก">
            {trainingTypes.map((type, index) => (
              <li
                className={index === trainingTypes.length - 1 && trainingTypes.length % 2 === 1
                  ? "home-training-types__item--wide"
                  : undefined}
                key={type.id}
              >
                <Link href={`/trainers?type=${type.slug}`}>
                  <span>{formatTrainingTypeName(type.nameTh)}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="home-empty-state">
            <strong>ยังไม่มีประเภทการฝึกให้เลือก</strong>
            <p>เปิดหน้าค้นหาเพื่อดูรายชื่อเทรนเนอร์ทั้งหมดที่พร้อมใช้งาน</p>
          </div>
        )}
      </section>

      <section className="home-featured" aria-labelledby="featured-trainers-title">
        <header className="home-section-heading">
          <h2 id="featured-trainers-title">เทรนเนอร์ที่น่าสนใจ</h2>
          <p>ดูข้อมูลสำคัญก่อนเปิดโปรไฟล์เพื่อตรวจรายละเอียดและเวลาว่าง</p>
        </header>
        {featuredTrainers.length > 0 ? (
          <div className="home-featured__grid">
            {featuredTrainers.map((trainer) => (
              <TrainerPreviewCard key={trainer.id} trainer={trainer} priority={trainer.id === priorityTrainerId} />
            ))}
          </div>
        ) : (
          <div className="home-empty-state">
            <strong>ยังไม่มีเทรนเนอร์ในรายการแนะนำ</strong>
            <p>เปิดหน้าค้นหาอีกครั้งเมื่อมีข้อมูล หรือปรับตัวกรองเพื่อดูรายการที่พร้อมใช้งาน</p>
          </div>
        )}
      </section>

      <section className="home-journey" aria-labelledby="journey-title">
        <div className="home-journey__intro">
          <h2 id="journey-title">ตั้งแต่ค้นหาจนจบการฝึก</h2>
          <p>ดูเส้นทางตั้งแต่เลือกเทรนเนอร์ ส่งคำขอ อัปโหลดสลิป จนถึงเขียนรีวิวหลังการฝึก</p>
        </div>
        <ol className="home-journey__steps">
          {journeySteps.map((step, index) => (
            <li key={step.title}>
              <span>ขั้นที่ {index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-trust" aria-labelledby="trust-title">
        <h2 id="trust-title">ตรวจโดยคน เห็นสถานะชัดเจน</h2>
        <div>
          <p>ผู้ดูแลระบบตรวจใบรับรอง ส่วนสลิปตรวจโดยเทรนเนอร์ฟรีแลนซ์หรือผู้ดูแลระบบสำหรับเทรนเนอร์ประจำยิม</p>
          <p>FitConnect แสดงผลการตรวจตามสถานะจริง ไม่ได้อนุมัติเอกสารหรือการชำระเงินอัตโนมัติ</p>
        </div>
      </section>

      <section className="home-final-cta" aria-labelledby="home-final-title">
        <div>
          <h2 id="home-final-title">พร้อมดูรายละเอียดแล้วหรือยัง</h2>
          <p>เปรียบเทียบข้อมูล ตรวจโปรไฟล์ และเลือกเวลาที่เหมาะกับคุณ</p>
        </div>
        <Link className="button button--accent" href="/trainers">ดูเทรนเนอร์ทั้งหมด</Link>
      </section>
    </div>
  );
}
