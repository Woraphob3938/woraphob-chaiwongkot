import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, CalendarClock, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDay, formatMoney, formatTime, initials } from "@/lib/format";
import type { Trainer } from "@/lib/types";

export function TrainerMarketplaceCard({
  trainer,
  priority = false,
}: {
  trainer: Trainer;
  priority?: boolean;
}) {
  const firstSlot = trainer.slots[0];

  return (
    <li className="trainer-marketplace-card">
      <div className="trainer-marketplace-card__media">
        {trainer.image ? (
          <Image
            src={trainer.image}
            alt={`รูปโปรไฟล์ของ${trainer.displayName}`}
            fill
            priority={priority}
            sizes="(max-width: 47.99rem) 100vw, (max-width: 75rem) 50vw, (max-width: 90rem) 33vw, 25vw"
          />
        ) : (
          <span aria-hidden="true">{initials(trainer.displayName)}</span>
        )}
      </div>

      <div className="trainer-marketplace-card__body">
        <div className="trainer-marketplace-card__eyebrow">
          <span>{trainer.trainingTypes[0]?.nameTh ?? "การฝึกส่วนบุคคล"}</span>
          {trainer.verification === "verified" && (
            <span className="trainer-marketplace-card__verified">
              <BadgeCheck aria-hidden="true" /> ตรวจคุณสมบัติแล้ว
            </span>
          )}
        </div>

        <div>
          <h2>{trainer.displayName}</h2>
          <p className="trainer-marketplace-card__headline">{trainer.headline}</p>
        </div>

        <div className="trainer-marketplace-card__meta">
          <span>ประสบการณ์ {trainer.yearsExperience} ปี</span>
          {trainer.reviewCount > 0 && trainer.rating !== undefined && (
            <span><Star aria-hidden="true" /> {trainer.rating} ({trainer.reviewCount} รีวิว)</span>
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
            <strong>{trainer.priceFrom == null ? "ยังไม่กำหนด" : formatMoney(trainer.priceFrom)}</strong>
          </div>
          <Button asChild>
            <Link href={`/trainers/${trainer.slug}`}>
              ดูโปรไฟล์และเลือกเวลา <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </li>
  );
}
