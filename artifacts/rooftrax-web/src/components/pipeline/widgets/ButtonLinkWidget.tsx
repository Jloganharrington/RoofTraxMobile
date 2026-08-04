/**
 * ButtonLinkWidget — opens an internal link (e.g. Claim Hub) in the same app.
 * Does NOT advance the stage automatically — it navigates to the relevant
 * screen so the rep can complete the work there, then an auto-advance event
 * fires when the work is done.
 *
 * config.href: URL pattern. `:leadId` is replaced with the actual leadId.
 */
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { Link } from 'wouter';
import { type WidgetProps } from './shared';

export function ButtonLinkWidget({ leadId, config }: WidgetProps) {
  const label = (config.label as string | undefined) ?? 'Open';
  const hrefTemplate = (config.href as string | undefined) ?? '#';
  const href = hrefTemplate.replace(':leadId', leadId);

  return (
    <Button asChild size="sm" variant="outline" className="w-full mt-2">
      <Link href={href}>
        <ExternalLink className="mr-2 h-3 w-3" />
        {label}
      </Link>
    </Button>
  );
}
