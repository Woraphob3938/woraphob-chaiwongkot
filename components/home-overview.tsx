import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarClock, Dumbbell, HeartPulse, MessagesSquare, ReceiptText, Search, Star } from "lucide-react";
import { TrainerPreviewCard } from "@/components/trainer-preview-card";
import { formatTrainingTypeName } from "@/lib/format";
import type { Trainer, TrainingType } from "@/lib/types";

type HomeOverviewProps = {
  trainers: Trainer[];
  trainingTypes: TrainingType[];
};

// บทที่ 1: the member sends a request, the trainer accepts, the system
// confirms it to the member right away,
// the member transfers within 10 minutes and the trainer checks the slip.
const journeySteps = [
  {
    title: "ค้นหาเทรนเนอร์",
    description: "กรองตามประเภทการฝึก รูปแบบบริการ และราคา แล้วเปิดดูโปรไฟล์",
    icon: Search,
  },
  {
    title: "ส่งคำขอจอง",
    description: "เลือกวันที่ต้องการฝึก ส่งคำขอพร้อมหมายเหตุถึงเทรนเนอร์",
    icon: CalendarClock,
  },
  {
    title: "เทรนเนอร์ตอบรับ",
    description: "ระบบแจ้งผลการตอบรับให้คุณทันที เวลาฝึกยังเป็นเวลาที่คุณเลือก",
    icon: BadgeCheck,
  },
  {
    title: "ชำระเงินภายใน 10 นาที",
    description: "ชำระออนไลน์ด้วยบัตรหรือพร้อมเพย์ ระบบยืนยันการจองให้ทันทีเมื่อชำระสำเร็จ",
    icon: ReceiptText,
  },
  {
    title: "ฝึกและรีวิว",
    description: "แชทนัดหมายกับเทรนเนอร์ เข้าฝึกตามเวลา แล้วเขียนรีวิวหลังจบการฝึก",
    icon: Star,
  },
] as const;

export function HomeOverview({ trainers, trainingTypes }: HomeOverviewProps) {
  const featuredTrainers = trainers.slice(0, 4);
  const priorityTrainerId = featuredTrainers.find((trainer) => trainer.image)?.id;
  const heroTrainers = trainers.filter((trainer) => trainer.image).slice(0, 2);
  const lowestPrice = trainers
    .map((trainer) => trainer.priceFrom)
    .filter((price): price is number => typeof price === "number" && price > 0)
    .sort((left, right) => left - right)[0];

  return (
    <div className="home-overview">
      <section className="home-intro" aria-labelledby="home-intro-title">
        <div className="home-intro__copy">
          <p className="home-intro__eyebrow"><Dumbbell aria-hidden="true" size={16} /> แพลตฟอร์มจองเทรนเนอร์ส่วนตัว</p>
          <h1 id="home-intro-title">หาเทรนเนอร์ที่ใช่<br />จองเวลาฝึกได้ในที่เดียว</h1>
          <p className="home-intro__lead">
            ดูโปรไฟล์ที่ผ่านการตรวจใบรับรอง ส่งคำขอจอง รอเทรนเนอร์ยืนยันเวลา ชำระเงิน และคุยกันในระบบ ตั้งแต่ครั้งแรกจนถึงรีวิว
          </p>
          <div className="home-intro__actions">
            <Link className="button button--accent" href="/trainers">เริ่มหาเทรนเนอร์ <ArrowRight aria-hidden="true" size={18} /></Link>
            <Link className="button button--outline" href="/register">สมัครเป็นเทรนเนอร์</Link>
          </div>
          <dl className="home-intro__facts">
            <div><dt>เทรนเนอร์ที่ผ่านการตรวจ</dt><dd>{trainers.length} คน</dd></div>
            <div><dt>ประเภทการฝึก</dt><dd>{trainingTypes.length} แบบ</dd></div>
            <div><dt>ค่าฝึกเริ่มต้น</dt><dd>{lowestPrice ? `฿${lowestPrice.toLocaleString("th-TH")}` : "—"}</dd></div>
          </dl>
        </div>

        <div className="home-intro__visual" aria-hidden="true">
          <div className="home-intro__frame">
            {heroTrainers.length > 0 ? (
              heroTrainers.map((trainer, index) => (
                // A background, not an <img>: a missing upload leaves the tinted
                // frame instead of a broken-image icon.
                <div key={trainer.id} className={`home-intro__photo home-intro__photo--${index}`} style={{ backgroundImage: `url("${trainer.image}")` }} />
              ))
            ) : (
              <div className="home-intro__placeholder"><HeartPulse size={64} /></div>
            )}
          </div>
          <div className="home-intro__note home-intro__note--top">
            <BadgeCheck size={18} />
            <span><strong>เทรนเนอร์ตอบรับแล้ว</strong><small>ชำระเงินภายใน 10 นาที</small></span>
          </div>
          <div className="home-intro__note home-intro__note--bottom">
            <MessagesSquare size={18} />
            <span><strong>แชทกับเทรนเนอร์</strong><small>ถามก่อนจองได้</small></span>
          </div>
        </div>
      </section>

      <section className="home-training-types" aria-labelledby="training-goals-title">
        <header className="home-section-heading">
          <h2 id="training-goals-title">เลือกจากเป้าหมายการฝึก</h2>
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
          <p>ดูเส้นทางตั้งแต่เลือกเทรนเนอร์ ส่งคำขอ ชำระเงินออนไลน์ จนถึงเขียนรีวิวหลังการฝึก</p>
        </div>
        <ol className="home-journey__steps">
          {journeySteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <span className="home-journey__icon" aria-hidden="true"><Icon size={20} /></span>
                <span className="home-journey__index">ขั้นที่ {index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="home-trust" aria-labelledby="trust-title">
        <h2 id="trust-title">ตรวจโดยคน เห็นสถานะชัดเจน</h2>
        <div>
          <p>ผู้ดูแลระบบตรวจใบรับรอง ส่วนการชำระเงินยืนยันอัตโนมัติผ่าน Stripe ทั้งแบบฟรีแลนซ์และประจำยิม</p>
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
