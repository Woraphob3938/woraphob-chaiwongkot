import Image from "next/image";
import Link from "next/link";
import { BadgeCheck, UserRound } from "lucide-react";
import { formatMoney, formatTrainingTypeName } from "@/lib/format";
import type { Trainer } from "@/lib/types";

type TrainerPreviewCardProps = {
  trainer: Trainer;
  priority?: boolean;
};

export function TrainerPreviewCard({ trainer, priority = false }: TrainerPreviewCardProps) {
  const specialty = formatTrainingTypeName(trainer.trainingTypes[0]?.nameTh ?? "การฝึกส่วนบุคคล");
  const price = trainer.priceFrom == null
    ? "สอบถามราคา"
    : `เริ่มต้น ${formatMoney(trainer.priceFrom)} / ครั้ง`;

  return (
    <article className="trainer-preview-card" data-testid="trainer-preview">
      <div className="trainer-preview-card__media">
        {trainer.image ? (
          <Image
            src={trainer.image}
            alt={`รูปโปรไฟล์ของ${trainer.displayName}`}
            width={320}
            height={240}
            priority={priority}
            sizes="(max-width: 38rem) 100vw, 20rem"
          />
        ) : (
          <span
            aria-label={`ยังไม่มีรูปโปรไฟล์ของ${trainer.displayName}`}
            className="trainer-preview-card__placeholder"
            role="img"
          >
            <UserRound aria-hidden="true" />
          </span>
        )}
        {trainer.demo && <span className="trainer-demo-label">ภาพสาธิต</span>}
      </div>

      <div className="trainer-preview-card__body">
        <div>
          <p className="trainer-preview-card__specialty">{specialty}</p>
          <h3>{trainer.displayName}</h3>
        </div>
        <div className="trainer-preview-card__facts">
          {trainer.verification === "verified" && <span><BadgeCheck aria-hidden="true" size={16} />โปรไฟล์ผ่านการตรวจ</span>}
        </div>
        <strong className="trainer-preview-card__price">{price}</strong>
        <Link className="trainer-preview-card__action" href={`/trainers/${trainer.slug}`}>ดูโปรไฟล์</Link>
      </div>
    </article>
  );
}
