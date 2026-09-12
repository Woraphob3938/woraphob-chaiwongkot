import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, CalendarClock, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDay, formatMoney, formatTime, initials } from "@/lib/format";
import type { Trainer } from "@/lib/types";

export function TrainerMarketplaceCard({
  trainer,
  priority = false,
  returnTo,
}: {
  trainer: Trainer;
  priority?: boolean;
  returnTo?: string;
}) {
  const firstSlot = trainer.slots[0];
  const profileHref = `/trainers/${trainer.slug}${returnTo && returnTo !== "/trainers" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  const canChooseTime = firstSlot !== undefined && trainer.priceFrom != null;
  const monthlyPrice = typeof trainer.monthlyPrice === "number" && trainer.monthlyPrice > 0
    && typeof trainer.monthlySessionCount === "number" && trainer.monthlySessionCount >= 2
    ? trainer.monthlyPrice
    : null;

  return (
    <li className="trainer-marketplace-card">
      <Link
        className="trainer-marketplace-card__media"
        href={profileHref}
        aria-label={`ดูโปรไฟล์ของ${trainer.displayName}`}
      >
        {trainer.image ? (
          <Image
            src={trainer.image}
            alt={`รูปโปรไฟล์ของ${trainer.displayName}`}
            fill
            priority={priority}
            sizes="(max-width: 40rem) 120px, (max-width: 75rem) 50vw, (max-width: 90rem) 33vw, 25vw"
          />
        ) : (
          <span aria-hidden="true">{initials(trainer.displayName)}</span>
        )}
        {trainer.demo && <span className="trainer-demo-label">ภาพสาธิต</span>}
      </Link>

      <div className="trainer-marketplace-card__body">
        <div className="trainer-marketplace-card__eyebrow">
          <span>{trainer.trainingTypes[0]?.nameTh ?? "การฝึกส่วนบุคคล"}</span>
          {trainer.verification === "verified" && (
            <span className="trainer-marketplace-card__verified">
              <BadgeCheck aria-hidden="true" /> โปรไฟล์ผ่านการตรวจ
            </span>
          )}
        </div>

        <div>
          <h2><Link href={profileHref}>{trainer.displayName}</Link></h2>
          <p className="trainer-marketplace-card__headline">{trainer.headline}</p>
        </div>

        <div className="trainer-marketplace-card__meta">
          <span>ประสบการณ์ {trainer.yearsExperience} ปี</span>
          {trainer.reviewCount > 0 && trainer.rating !== undefined && (
            <span><Star aria-hidden="true" /> {trainer.rating} ({trainer.reviewCount} รีวิว)</span>
          )}
          {(trainer.reviewCount === 0 || trainer.rating === undefined) && (
            <span><Star aria-hidden="true" /> ยังไม่มีรีวิว</span>
          )}
          <span>
            <CalendarClock aria-hidden="true" />
            {firstSlot
              ? `ว่างเร็วสุด ${formatDay(firstSlot.startsAt)} ${formatTime(firstSlot.startsAt)} น.`
              : "ยังไม่มีเวลาว่าง"}
          </span>
        </div>

        <div className="trainer-marketplace-card__footer">
          <div>
            <span>ค่าฝึกต่อครั้ง</span>
            <strong className={trainer.priceFrom == null ? "is-unavailable" : undefined}>
              {trainer.priceFrom == null ? "ยังไม่กำหนด" : formatMoney(trainer.priceFrom)}
            </strong>
            {/* The price alone hides half the offer, and this fact is already on
                the trainer's own profile, so comparing means opening each one. */}
            <small className={monthlyPrice == null ? "is-unavailable" : undefined}>
              {monthlyPrice == null
                ? "ยังไม่เปิดแพ็กเกจ 30 วัน"
                : `แพ็กเกจ 30 วัน ${formatMoney(monthlyPrice)} · ${trainer.monthlySessionCount} ครั้ง`}
            </small>
          </div>
          <Button asChild variant={canChooseTime ? "default" : "outline"}>
            <Link href={profileHref}>
              {canChooseTime ? "ดูโปรไฟล์และเลือกเวลา" : "ดูโปรไฟล์"} <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </li>
  );
}
