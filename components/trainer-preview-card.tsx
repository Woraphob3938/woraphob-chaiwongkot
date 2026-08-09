import Image from "next/image";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { formatMoney, initials } from "@/lib/format";
import type { Trainer } from "@/lib/types";

type TrainerPreviewCardProps = {
  trainer: Trainer;
  priority?: boolean;
};

export function TrainerPreviewCard({ trainer, priority = false }: TrainerPreviewCardProps) {
  const specialty = trainer.trainingTypes[0]?.nameTh ?? "การฝึกส่วนบุคคล";
  const price = trainer.priceFrom == null
    ? "สอบถามราคา"
    : `เริ่มต้น ${formatMoney(trainer.priceFrom)} / ครั้ง`;

  return (
    <article className="trainer-preview-card" data-testid="trainer-preview">
      <div className="trainer-preview-card__media">
        {trainer.image ? (
          <Image
            src={trainer.image}
            alt={trainer.demo
              ? `ภาพสังเคราะห์ของ${trainer.displayName} ใช้เพื่อสาธิต`
              : `ภาพบุคคลของ${trainer.displayName}`}
            width={320}
            height={240}
            priority={priority}
            sizes="(max-width: 38rem) 100vw, 20rem"
          />
        ) : (
          <span className="trainer-preview-card__initials" aria-hidden="true">{initials(trainer.displayName)}</span>
        )}
        {trainer.demo && <span className="trainer-preview-card__demo">ภาพสังเคราะห์ · สาธิต</span>}
      </div>

      <div className="trainer-preview-card__body">
        <div>
          <p className="trainer-preview-card__specialty">{specialty}</p>
          <h3>{trainer.displayName}</h3>
        </div>
        <div className="trainer-preview-card__facts">
          {trainer.verification === "verified" && <span><BadgeCheck aria-hidden="true" size={16} />ตรวจคุณสมบัติแล้ว</span>}
        </div>
        <strong className="trainer-preview-card__price">{price}</strong>
        <Link className="trainer-preview-card__action" href={`/trainers/${trainer.slug}`}>ดูโปรไฟล์</Link>
      </div>
    </article>
  );
}
