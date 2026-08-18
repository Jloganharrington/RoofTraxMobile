/**
 * UploadWidget — prompts the rep to upload a file (e.g. Certificate of
 * Completion), then advances the stage after confirmation.
 *
 * File upload itself goes through the existing /api/leads/:leadId/files
 * endpoint. This widget links to the Files tab and shows a confirm button
 * once the rep indicates the upload is done.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Upload } from 'lucide-react';
import { Link } from 'wouter';
import { useAdvanceStage, type WidgetProps } from './shared';

export function UploadWidget({ leadId, toStage, config, onSuccess }: WidgetProps) {
  const label = (config.label as string | undefined) ?? 'Upload Document';
  const [confirmed, setConfirmed] = useState(false);
  const { mutate, isPending } = useAdvanceStage(leadId);

  function handleAdvance() {
    mutate(
      {
        toStage,
        trigger:     'task',
        taskPayload: { uploadConfirmed: true },
      },
      { onSuccess: (data) => onSuccess?.(data.lead) },
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-muted-foreground">{label}</p>

      {/* Link to the Files tab for this lead */}
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link href={`/leads/${leadId}?tab=files`}>
          <Upload className="mr-2 h-3 w-3" />
          Open Files Tab
        </Link>
      </Button>

      {!confirmed ? (
        <Button
          size="sm"
          variant="ghost"
          className="w-full text-xs"
          onClick={() => setConfirmed(true)}
        >
          I've uploaded the document
        </Button>
      ) : (
        <Button
          size="sm"
          className="w-full"
          onClick={handleAdvance}
          disabled={isPending}
        >
          {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          Confirm &amp; Advance Stage
        </Button>
      )}
    </div>
  );
}
