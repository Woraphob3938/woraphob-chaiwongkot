import Link from "next/link";
import { useId, type ReactNode } from "react";
import type { DashboardAction } from "@/lib/dashboard-actions";

export function NextActionCard({ action, onFollow }: { action: DashboardAction; onFollow?: () => void }) {
  const titleId = useId();

  return (
    <section className="next-action-card" aria-labelledby={titleId} data-state={action.state} data-testid="next-action">
      <div>
        <h2 id={titleId}>{action.title}</h2>
        <p className="next-action-card__description">{action.description}</p>
      </div>
      {/* `onFollow` lets the surface finish the promise the card makes — moving
          focus onto the record it just named. Next's client-side navigation
          pushes history state instead of changing the hash, so a `hashchange`
          listener alone never hears about this click. */}
      <Link className="button button--accent" href={action.href} onClick={onFollow}>{action.cta}</Link>
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
          <Link className="text-link" href={action.href} aria-label={actionName}>{action.label}</Link>
        )}
      </header>
      {children}
    </section>
  );
}
