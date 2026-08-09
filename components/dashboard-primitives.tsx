import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DashboardAction } from "@/lib/dashboard-actions";

export function NextActionCard({ action }: { action: DashboardAction }) {
  const titleId = useId();

  return (
    <section className="next-action-card" aria-labelledby={titleId} data-state={action.state} data-testid="next-action">
      <div>
        <p className="next-action-card__eyebrow">สิ่งที่ต้องทำต่อ</p>
        <h2 id={titleId}>{action.title}</h2>
        <p className="next-action-card__description">{action.description}</p>
      </div>
      <Button asChild>
        <Link href={action.href}>{action.cta}</Link>
      </Button>
    </section>
  );
}

export function DashboardSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  children: ReactNode;
}) {
  const titleId = useId();
  const actionName = action ? `${action.label}: ${title}` : undefined;

  return (
    <section className="dashboard-section" aria-labelledby={titleId}>
      <header className="dashboard-section__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && (
          <Button asChild variant="link">
            <Link href={action.href} aria-label={actionName}>{action.label}</Link>
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}
