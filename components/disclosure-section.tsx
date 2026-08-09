import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type DisclosureSectionProps = {
  title: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function DisclosureSection({
  title,
  summary,
  defaultOpen = false,
  children,
  className = "",
}: DisclosureSectionProps) {
  return (
    <details
      className={["disclosure-section", className].filter(Boolean).join(" ")}
      open={defaultOpen || undefined}
    >
      <summary>
        <span className="disclosure-section__label">
          <strong>{title}</strong>
          {summary && <small>{summary}</small>}
        </span>
        <ChevronDown aria-hidden="true" size={20} />
      </summary>
      <div className="disclosure-section__content">{children}</div>
    </details>
  );
}
