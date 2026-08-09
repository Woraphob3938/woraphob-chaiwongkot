import { Award, Building2, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { Trainer } from "@/lib/types";

export function CredentialCard({ trainer }: { trainer: Trainer }) {
  return (
    <section className="credential-card" aria-label={`หลักฐานคุณสมบัติของ ${trainer.displayName}`}>
      <div className="credential-heading">
        <div>
          <p className="label">บัตรคุณสมบัติเทรนเนอร์</p>
          <h3>คุณสมบัติและประสบการณ์</h3>
          <p>{trainer.headline}</p>
        </div>
        <StatusBadge status={trainer.verification} />
      </div>

      <div className="certificate-list">
        <div className="section-line-heading">
          <h3>หลักฐานคุณสมบัติ</h3>
          <span>{trainer.certificates.length} รายการ</span>
        </div>
        {trainer.certificates.map((certificate) => (
          <div className="certificate-row" key={certificate.id}>
            <div>
              <strong>{certificate.name}</strong>
              <span>{certificate.issuer}{certificate.issuedYear ? ` · ${certificate.issuedYear}` : ""}</span>
            </div>
            <StatusBadge status={certificate.status} />
          </div>
        ))}
      </div>

      <dl className="credential-specs">
        <div>
          <dt><MapPin aria-hidden="true" size={17} /> พื้นที่บริการ</dt>
          <dd>{trainer.province.nameTh}</dd>
        </div>
        <div>
          <dt><Award aria-hidden="true" size={17} /> ประสบการณ์</dt>
          <dd>{trainer.yearsExperience} ปี</dd>
        </div>
        <div>
          <dt><Building2 aria-hidden="true" size={17} /> รูปแบบ</dt>
          <dd>{trainer.serviceMode === "gym" ? "ประจำฟิตเนส" : trainer.serviceMode === "freelance" ? "ฟรีแลนซ์" : "ฟรีแลนซ์ / ฟิตเนส"}</dd>
        </div>
      </dl>

      <div className="expertise-row">
        {trainer.trainingTypes.map((type) => <span key={type.id}>{type.nameTh}</span>)}
      </div>

    </section>
  );
}
