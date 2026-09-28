import { Building2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { Trainer } from "@/lib/types";

/**
 * The evidence behind the profile, opened from its disclosure. The headline,
 * verification badge, years of experience and training types already sit
 * above it on the page, so this lists only what is not shown there: each
 * certificate and the service mode.
 */
export function CredentialCard({ trainer }: { trainer: Trainer }) {
  return (
    <section className="credential-card credential-card--compact" aria-label={`หลักฐานคุณสมบัติของ ${trainer.displayName}`}>
      <h2 className="sr-only">คุณสมบัติและประสบการณ์</h2>
      <h3 className="sr-only">หลักฐานคุณสมบัติ</h3>
      {trainer.certificates.length > 0 ? (
        <ul className="credential-card__list">
          {trainer.certificates.map((certificate) => (
            <li key={certificate.id}>
              <span>
                <strong>{certificate.name}</strong>
                <small>{certificate.issuer}{certificate.issuedYear ? ` · ${certificate.issuedYear}` : ""}</small>
              </span>
              <StatusBadge status={certificate.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="credential-card__empty">ยังไม่มีใบรับรองที่แสดงต่อสมาชิก</p>
      )}
      <p className="credential-card__mode">
        <Building2 aria-hidden="true" size={16} /> รูปแบบบริการ <strong>{trainer.serviceMode === "freelance" ? "ฟรีแลนซ์" : trainer.serviceMode === "both" ? "ฟรีแลนซ์และฟิตเนสประจำยิม" : "ฟิตเนสประจำยิม"}</strong>
      </p>
    </section>
  );
}
