/**
 * ButtonLinkWidget — opens an internal link (e.g. Claim Hub) in the same app.
 * Does NOT advance the stage automatically — it navigates to the relevant
 * screen so the rep can complete the work there, then an auto-advance event
 * fires when the work is done.
 *
 * config.href: URL pattern. `:leadId` is replaced with the actual leadId.
 */
import { ExternalLink } from 'lucide-react';
import { Link } from 'wouter';
import { type WidgetProps } from './shared';

export function ButtonLinkWidget({ leadId, config }: WidgetProps) {
  const label        = (config.label as string | undefined) ?? 'Open';
  const hrefTemplate = (config.href  as string | undefined) ?? '#';
  const href         = hrefTemplate.replace(':leadId', leadId);

  return (
    <Link href={href}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer select-none">
        <ExternalLink className="h-3 w-3 shrink-0" />
        {label}
      </span>
    </Link>
  );
}
