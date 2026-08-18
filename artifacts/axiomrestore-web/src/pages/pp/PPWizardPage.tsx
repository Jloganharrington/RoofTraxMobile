/**
 * /pp/wizard/:id — PP Generation Wizard
 *
 * Step 0 — Payment gate
 * Step 1 — Photo Curation
 * Step 2 — Caption Review
 * Step 3 — Readiness Check
 * Step 4 — Compile & Download
 *
 * All API calls use direct fetch with credentials:include so they work with
 * the PP session cookie (no Bearer token required).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import {
  CreditCard, Camera, Sparkles, ClipboardCheck, Download,
  CheckCircle2, AlertCircle, XCircle, Loader2, ArrowLeft,
  ArrowRight, ExternalLink, RotateCcw, ChevronDown, ChevronUp,
  Lock, Upload, X, FileText,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreditStatus { paid: boolean; paidAt: string | null }

type PhotoBrief = {
  id: string; url: string; stage: string | null;
  subjectType: string; triadRole: string | null;
  preliminaryRole: string | null;
};

type ExhibitClass = 'R' | 'S' | 'I' | 'F' | 'C' | 'T';

type ExhibitSelection = {
  id: string; photoId: string;
  exhibitClass: ExhibitClass | null; badgeLabel: string | null;
  sortOrder: number;
};

type CurationState = {
  inspectionId: string;
  photos: PhotoBrief[];
  selections: ExhibitSelection[];
  isFinalized: boolean;
  captions: Array<{
    id: string; exhibitSelectionId: string;
    badgeLabel: string; captionText: string | null;
    state: string; generatedAt: string | null;
  }>;
};

type ReadinessItem = { key: string; label: string; state: 'pass' | 'fail' | 'warning'; detail: string | null };
type ReadinessResult = { inspectionId: string; overallPass: boolean; items: ReadinessItem[] };

type UploadedPhoto = { id: string; url: string; subjectType: string; createdAt: string | null };

type SlotPhoto = { id: string; url: string; subjectType: string; triadRole: string | null; stage: string | null };
type ExhibitSlot = {
  slotKey: string; label: string; required: boolean; kind: 'single' | 'comparison';
  candidates: SlotPhoto[]; confirmedPhotoId: string | null; isSkipped: boolean;
};
type ExhibitSlotsResp = { inspectionId: string; slots: ExhibitSlot[]; allRequiredConfirmed: boolean };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = [
  { title: 'Payment', icon: CreditCard },
  { title: 'Evidence', icon: Upload },
  { title: 'Photos', icon: Camera },
  { title: 'Captions', icon: Sparkles },
  { title: 'Readiness', icon: ClipboardCheck },
  { title: 'Compile', icon: Download },
] as const;

const CLASS_LABELS: Record<ExhibitClass, string> = {
  R: 'Roof', S: 'Storm', I: 'Interior', F: 'Field Meas.', C: 'Collateral', T: 'Test Sq.',
};

const CLASS_COLORS: Record<ExhibitClass, string> = {
  R: 'bg-blue-500/20 text-blue-300 border-blue-700',
  S: 'bg-purple-500/20 text-purple-300 border-purple-700',
  I: 'bg-orange-500/20 text-orange-300 border-orange-700',
  F: 'bg-green-500/20 text-green-300 border-green-700',
  C: 'bg-yellow-500/20 text-yellow-300 border-yellow-700',
  T: 'bg-red-500/20 text-red-300 border-red-700',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ppFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Step progress header
// ---------------------------------------------------------------------------

function StepHeader({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-1 flex-shrink-0">
            <div className={[
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              done ? 'bg-green-900/40 text-green-400 border border-green-800' :
              active ? 'bg-orange-500/20 text-orange-400 border border-orange-700' :
              'bg-zinc-900 text-zinc-600 border border-zinc-800',
            ].join(' ')}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" /> : <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
              <span className="hidden sm:inline">{s.title}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={['h-px w-4 flex-shrink-0', done ? 'bg-green-700' : 'bg-zinc-800'].join(' ')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — Payment gate
// ---------------------------------------------------------------------------

function Step0Payment({
  inspectionId, onPaid,
}: { inspectionId: string; onPaid: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setErr(null);
    try {
      const data = await ppFetch<{ checkoutUrl: string | null; alreadyPaid: boolean }>(
        '/api/pp/packages/checkout',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionId }) },
      );
      if (data.alreadyPaid) {
        onPaid();
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Checkout failed');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6 text-center">
      <div className="h-16 w-16 rounded-2xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
        <CreditCard className="h-8 w-8 text-orange-400" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl font-bold text-white">Unlock this Package</h2>
        <p className="text-sm text-zinc-400">
          A one-time fee unlocks Proof Package generation for this inspection. Recompilation is
          free once paid.
        </p>
      </div>
      {err && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-4 py-2.5 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {err}
        </div>
      )}
      <button
        onClick={handleCheckout}
        disabled={loading}
        className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-orange-800 disabled:text-orange-400 text-white rounded-lg transition-colors"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {loading ? 'Redirecting to payment…' : 'Pay & Unlock Package'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Evidence Upload
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
type AcceptedType = (typeof ACCEPTED_TYPES)[number];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_FILES = 50;

function isPdf(url: string) {
  // Object paths are UUIDs with no extension; we track type via content
  // but for display we use a simple heuristic on the URL fragment stored
  // when the client registered the photo. Since we don't persist the
  // contentType column, fall back to showing an image thumbnail for all.
  return url.endsWith('.pdf');
}

function StepUpload({
  inspectionId, onContinue,
}: { inspectionId: string; onContinue: () => void }) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [isUploadPath, setIsUploadPath] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await ppFetch<{ photos: UploadedPhoto[]; isUploadPath: boolean; count: number }>(
        `/api/pp/inspections/${inspectionId}/photos`,
      );
      setPhotos(data.photos);
      setIsUploadPath(data.isUploadPath);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => { void load(); }, [load]);

  async function computeSha256(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function handleFiles(files: FileList) {
    if (uploading) return;
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    // Client-side validation
    for (const file of fileArr) {
      if (!ACCEPTED_TYPES.includes(file.type as AcceptedType)) {
        setErr(`"${file.name}" is not a JPEG, PNG, or PDF file.`);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setErr(`"${file.name}" exceeds the 20 MB limit.`);
        return;
      }
    }

    if (photos.length + fileArr.length > MAX_FILES) {
      setErr(`Cannot upload ${fileArr.length} file(s) — would exceed the ${MAX_FILES}-file limit.`);
      return;
    }

    setUploading(true);
    setErr(null);

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      setUploadProgress(`Uploading ${i + 1} of ${fileArr.length}: ${file.name}`);
      try {
        // 1. Get presigned URL
        const { uploadURL, objectPath } = await ppFetch<{ uploadURL: string; objectPath: string }>(
          `/api/pp/inspections/${inspectionId}/photos/upload-url`,
        );

        // 2. Compute SHA-256
        const sha256 = await computeSha256(file);

        // 3. PUT directly to GCS
        const putRes = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Upload failed (HTTP ${putRes.status})`);
        }

        // 4. Register the photo record
        await ppFetch(`/api/pp/inspections/${inspectionId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            objectPath,
            sha256,
            contentType: file.type,
            fileName: file.name,
            fileSizeBytes: file.size,
          }),
        });
      } catch (e: unknown) {
        setErr(`Failed to upload "${file.name}": ${e instanceof Error ? e.message : 'Unknown error'}`);
        setUploading(false);
        setUploadProgress(null);
        await load();
        return;
      }
    }

    setUploading(false);
    setUploadProgress(null);
    // Reset file input so the same files can be re-selected if needed.
    if (fileInputRef.current) fileInputRef.current.value = '';
    await load();
  }

  async function handleDelete(photoId: string) {
    setDeletingId(photoId);
    setErr(null);
    try {
      await ppFetch(`/api/pp/inspections/${inspectionId}/photos/${photoId}`, { method: 'DELETE' });
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;
  }

  // For field-inspection PP packages (pinId ≠ null), photos come from the
  // mobile app — skip the upload UI and go straight to curation.
  if (isUploadPath === false) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          This inspection was captured via the mobile app. Your photos are already loaded
          and ready to curate in the next step.
        </p>
        <p className="text-xs text-zinc-500">{photos.length} photo{photos.length !== 1 ? 's' : ''} available for curation.</p>
        <div className="pt-2">
          <button
            onClick={onContinue}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
          >
            Continue to Photo Selection <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const imagePhotos = photos.filter((p) => !isPdf(p.url));
  const pdfPhotos = photos.filter((p) => isPdf(p.url));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-zinc-200">
          Upload your evidence — carrier photos, adjuster reports, drone imagery.
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">
          JPEG, PNG, or PDF · max 20 MB each · up to {MAX_FILES} files total ·{' '}
          <span className={photos.length >= MAX_FILES ? 'text-red-400' : 'text-zinc-400'}>
            {photos.length} uploaded
          </span>
        </p>
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-4 py-2.5 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {err}
        </div>
      )}

      {uploadProgress && (
        <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-4 py-2.5 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-orange-400 flex-shrink-0" />
          {uploadProgress}
        </div>
      )}

      {/* Drop / pick area */}
      {photos.length < MAX_FILES && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,application/pdf"
            className="hidden"
            onChange={(e) => e.target.files && void handleFiles(e.target.files)}
            disabled={uploading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={[
              'w-full flex flex-col items-center gap-3 py-8 border-2 border-dashed rounded-xl transition-colors',
              uploading
                ? 'border-zinc-700 opacity-60 cursor-not-allowed'
                : 'border-zinc-700 hover:border-orange-500 hover:bg-orange-500/5 cursor-pointer',
            ].join(' ')}
          >
            {uploading
              ? <Loader2 className="h-8 w-8 text-orange-400 animate-spin" />
              : <Upload className="h-8 w-8 text-zinc-600" />}
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-300">
                {uploading ? 'Uploading…' : 'Click to choose files'}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5">JPEG · PNG · PDF</p>
            </div>
          </button>
        </div>
      )}

      {/* Uploaded images grid */}
      {imagePhotos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Images ({imagePhotos.length})</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {imagePhotos.map((photo) => (
              <div key={photo.id} className="relative group rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
                <div className="aspect-[4/3]">
                  <img
                    src={`/api/storage/proxy?path=${encodeURIComponent(photo.url)}`}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <button
                  onClick={() => void handleDelete(photo.id)}
                  disabled={deletingId === photo.id}
                  title="Remove"
                  className="absolute top-1 right-1 bg-black/60 hover:bg-red-900/80 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {deletingId === photo.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <X className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uploaded PDFs list */}
      {pdfPhotos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Documents ({pdfPhotos.length})</p>
          <div className="space-y-1">
            {pdfPhotos.map((photo) => (
              <div key={photo.id} className="flex items-center gap-3 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
                <FileText className="h-4 w-4 text-zinc-500 flex-shrink-0" />
                <span className="text-xs text-zinc-400 flex-1 truncate">{photo.url.split('/').pop()}</span>
                <button
                  onClick={() => void handleDelete(photo.id)}
                  disabled={deletingId === photo.id}
                  title="Remove"
                  className="flex-shrink-0 text-zinc-600 hover:text-red-400 transition-colors"
                >
                  {deletingId === photo.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <X className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {photos.length === 0 && !uploading && (
        <p className="text-xs text-zinc-600 text-center py-4">
          No files uploaded yet — click the area above to add your evidence.
        </p>
      )}

      {/* Bottom action row */}
      <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-zinc-500">
          {photos.length > 0
            ? `${photos.length} file${photos.length !== 1 ? 's' : ''} ready to curate.`
            : 'You can also continue without uploading if photos were captured via another method.'}
        </span>
        <button
          onClick={onContinue}
          disabled={uploading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition-colors"
        >
          Continue to Photo Selection <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Photo Curation
// ---------------------------------------------------------------------------

function Step1Curation({
  inspectionId, onFinalized,
}: { inspectionId: string; onFinalized: () => void }) {
  const [curation, setCuration] = useState<CurationState | null>(null);
  const [slotsResp, setSlotsResp] = useState<ExhibitSlotsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmingSlot, setConfirmingSlot] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [data, slots] = await Promise.all([
        ppFetch<CurationState>(`/api/${inspectionId}/curation`),
        ppFetch<ExhibitSlotsResp>(`/api/${inspectionId}/exhibit-slots`).catch(() => null),
      ]);
      setCuration(data);
      setSlotsResp(slots);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load curation');
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => { void load(); }, [load]);

  async function togglePhoto(photoId: string, selected: boolean) {
    if (!curation || curation.isFinalized) return;
    setTogglingId(photoId);
    try {
      await ppFetch(`/api/${inspectionId}/curation/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected }),
      });
      await load();
    } catch {
      // silently ignore — grid will be stale; next click will retry
    } finally {
      setTogglingId(null);
    }
  }

  async function handlePropose() {
    setProposing(true);
    try {
      await ppFetch(`/api/${inspectionId}/curation/propose`, { method: 'POST' });
      await load();
    } finally {
      setProposing(false);
    }
  }

  async function confirmSlot(slotKey: string, photoId: string) {
    setConfirmingSlot(slotKey);
    setErr(null);
    try {
      await ppFetch(`/api/inspections/${inspectionId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'slot_confirmed', payload: { slotKey, photoId } }),
      });
      // Refresh only slot state to keep photo grid stable.
      const updated = await ppFetch<ExhibitSlotsResp>(`/api/${inspectionId}/exhibit-slots`).catch(() => null);
      if (updated) setSlotsResp(updated);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Slot confirmation failed');
    } finally {
      setConfirmingSlot(null);
    }
  }

  async function handleFinalize() {
    if (!curation) return;
    setFinalizing(true);
    setErr(null);
    try {
      await ppFetch(`/api/${inspectionId}/curation/finalize`, { method: 'POST' });
      onFinalized();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Finalize failed');
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;
  if (err && !curation) return (
    <div className="flex flex-col items-center gap-3 py-12">
      <AlertCircle className="h-8 w-8 text-red-400" />
      <p className="text-sm text-zinc-400">{err}</p>
      <button onClick={load} className="text-xs text-orange-400 hover:text-orange-300 underline">Retry</button>
    </div>
  );
  if (!curation) return null;

  const selectedIds = new Set(curation.selections.map((s) => s.photoId));
  const selectionMap = new Map(curation.selections.map((s) => [s.photoId, s]));
  const isFinalized = curation.isFinalized;

  // Required single slots that are not yet confirmed.
  const requiredUnconfirmed = (slotsResp?.slots ?? []).filter(
    (s) => s.required && s.kind === 'single' && s.confirmedPhotoId === null,
  );
  const allRequiredConfirmed = slotsResp ? slotsResp.allRequiredConfirmed : true;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-zinc-200">
            Select photos for the Proof Package — aim for ~10 key exhibits.
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {curation.selections.length} selected
            {isFinalized ? ' · badges frozen' : ' · badges assigned at finalization'}
          </p>
        </div>
        {!isFinalized && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePropose}
              disabled={proposing || curation.photos.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              AI Propose
            </button>
          </div>
        )}
        {isFinalized && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-400 bg-green-900/30 border border-green-800 px-2.5 py-1 rounded-full">
            <Lock className="h-3 w-3" /> Badges Frozen
          </span>
        )}
      </div>

      {curation.photos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Camera className="h-10 w-10 text-zinc-700" />
          <p className="text-sm text-zinc-400">No photos yet — your field reps upload photos via the mobile app.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          {curation.photos.map((photo) => {
            const sel = selectionMap.get(photo.id);
            const selected = selectedIds.has(photo.id);
            const isToggling = togglingId === photo.id;
            return (
              <button
                key={photo.id}
                onClick={() => void togglePhoto(photo.id, !selected)}
                disabled={isFinalized || isToggling}
                className={[
                  'relative rounded-lg overflow-hidden border-2 transition-all text-left',
                  selected ? 'border-orange-500 ring-2 ring-orange-500/30' : 'border-transparent hover:border-zinc-600',
                  isFinalized ? 'cursor-default' : '',
                ].join(' ')}
              >
                <div className="aspect-[4/3] bg-zinc-800">
                  <img
                    src={`/api/storage/proxy?path=${encodeURIComponent(photo.url)}`}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                {selected && (
                  <div className="absolute top-1.5 left-1.5">
                    <CheckCircle2 className="h-4 w-4 text-orange-500 drop-shadow" />
                  </div>
                )}
                {sel?.badgeLabel && (
                  <div className="absolute top-1.5 right-1.5">
                    <span className={[
                      'text-[10px] font-bold px-1.5 py-0.5 rounded border',
                      sel.exhibitClass ? CLASS_COLORS[sel.exhibitClass] : 'bg-zinc-700 text-zinc-300 border-zinc-600',
                    ].join(' ')}>
                      {sel.badgeLabel}
                    </span>
                  </div>
                )}
                {isToggling && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 truncate">
                  {photo.stage ?? photo.subjectType}
                  {photo.triadRole ? ` · ${photo.triadRole}` : ''}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Required slot assignments ───────────────────────────────────── */}
      {!isFinalized && requiredUnconfirmed.length > 0 && (
        <div className="space-y-3 border-t border-zinc-800 pt-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Required Slot Assignments</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Assign a selected photo to each slot below before finalizing.
            </p>
          </div>
          {requiredUnconfirmed.map((slot) => {
            const slotCandidates = slot.candidates.filter((c) => selectedIds.has(c.id));
            return (
              <div key={slot.slotKey} className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-zinc-300">{slot.label}</p>
                {slotCandidates.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">
                    No matching selected photos — select a photo above first.
                  </p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {slotCandidates.map((photo) => (
                      <button
                        key={photo.id}
                        onClick={() => void confirmSlot(slot.slotKey, photo.id)}
                        disabled={confirmingSlot === slot.slotKey}
                        title={`${photo.stage ?? photo.subjectType}${photo.triadRole ? ` · ${photo.triadRole}` : ''}`}
                        className={[
                          'relative rounded-lg overflow-hidden border-2 transition-all w-20 h-16 flex-shrink-0',
                          slot.confirmedPhotoId === photo.id
                            ? 'border-orange-500 ring-2 ring-orange-500/30'
                            : 'border-zinc-600 hover:border-zinc-400',
                        ].join(' ')}
                      >
                        <img
                          src={`/api/storage/proxy?path=${encodeURIComponent(photo.url)}`}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        {confirmingSlot === slot.slotKey && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {err && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-4 py-2.5 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {err}
        </div>
      )}

      {/* ── Bottom action row ────────────────────────────────────────────── */}
      <div className="pt-2 border-t border-zinc-800">
        {isFinalized ? (
          /* Already finalized (resume path): show Continue instead of Finalize */
          <>
            <p className="text-xs text-zinc-500 mb-2">
              Photo selection is already finalized. Click Continue to proceed to captions.
            </p>
            <button
              onClick={onFinalized}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
            >
              Continue to Captions <ArrowRight className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-zinc-500 mb-2">
              Finalization locks your badge assignments and makes captions available for review.
              {!allRequiredConfirmed && (
                <span className="text-yellow-400 ml-1">Confirm all required slots above first.</span>
              )}
            </p>
            <button
              onClick={handleFinalize}
              disabled={finalizing || curation.selections.length === 0 || !allRequiredConfirmed}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition-colors"
            >
              {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {finalizing ? 'Finalizing…' : 'Finalize Selection'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Caption Review
// ---------------------------------------------------------------------------

function Step2Captions({
  inspectionId, onApproved,
}: { inspectionId: string; onApproved: () => void }) {
  const [curation, setCuration] = useState<CurationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editMap, setEditMap] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await ppFetch<CurationState>(`/api/${inspectionId}/curation`);
      setCuration(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load captions');
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => { void load(); }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setErr(null);
    try {
      await ppFetch(`/api/${inspectionId}/sections/captions/generate`, { method: 'POST' });
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Caption generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function saveCaption(captionId: string, text: string) {
    setSavingId(captionId);
    try {
      await ppFetch(`/api/${inspectionId}/sections/captions/${captionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captionText: text }),
      });
      await load();
      setEditMap((m) => { const n = { ...m }; delete n[captionId]; return n; });
    } finally {
      setSavingId(null);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setErr(null);
    try {
      await ppFetch(`/api/${inspectionId}/sections/captions/approve`, { method: 'POST' });
      onApproved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;
  if (!curation) return null;

  const captions = curation.captions ?? [];
  const hasCaptions = captions.length > 0;
  const allApproved = hasCaptions && captions.every((c) => c.state === 'approved' || c.state === 'locked');

  const STATE_COLORS: Record<string, string> = {
    pending: 'text-zinc-500',
    generated: 'text-blue-400',
    in_review: 'text-yellow-400',
    approved: 'text-green-400',
    locked: 'text-green-400',
  };
  const STATE_LABELS: Record<string, string> = {
    pending: 'Pending', generated: 'Generated', in_review: 'In review',
    approved: 'Approved', locked: 'Locked',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-zinc-200">Review AI-generated captions for each exhibit photo.</p>
          <p className="text-xs text-zinc-500 mt-0.5">Edit any caption, then approve all to continue.</p>
        </div>
        {!hasCaptions && (
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-orange-800 text-white rounded-lg transition-colors"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {generating ? 'Generating…' : 'Generate Captions'}
          </button>
        )}
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-4 py-2.5 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {err}
        </div>
      )}

      {!hasCaptions ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Sparkles className="h-8 w-8 text-zinc-700" />
          <p className="text-sm text-zinc-500">
            No captions yet — click Generate to create AI captions for your selected photos.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {captions.map((c) => {
            const isExpanded = expandedId === c.id;
            const editText = editMap[c.id] ?? c.captionText ?? '';
            const isDirty = editMap[c.id] !== undefined && editMap[c.id] !== (c.captionText ?? '');
            return (
              <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-bold text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded flex-shrink-0">{c.badgeLabel}</span>
                    <span className="text-sm text-zinc-300 truncate">{c.captionText ?? 'No caption yet'}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={['text-xs font-medium', STATE_COLORS[c.state] ?? 'text-zinc-500'].join(' ')}>
                      {STATE_LABELS[c.state] ?? c.state}
                    </span>
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-zinc-800 pt-3 space-y-2">
                    <textarea
                      rows={3}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-orange-500 transition-colors"
                      value={editText}
                      onChange={(e) => setEditMap((m) => ({ ...m, [c.id]: e.target.value }))}
                      placeholder="Enter caption text…"
                    />
                    {isDirty && (
                      <button
                        onClick={() => void saveCaption(c.id, editText)}
                        disabled={savingId === c.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
                      >
                        {savingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Save
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasCaptions && (
        <div className="pt-2 border-t border-zinc-800">
          {allApproved ? (
            /* Already approved (resume path): show Continue instead of re-approve */
            <>
              <p className="text-xs text-zinc-500 mb-2">All captions approved. Click Continue to proceed.</p>
              <button
                onClick={onApproved}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
              >
                Continue to Readiness <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition-colors"
            >
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {approving ? 'Approving…' : 'Approve All Captions'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Readiness Check
// ---------------------------------------------------------------------------

function Step3Readiness({
  inspectionId, onReady,
}: { inspectionId: string; onReady: () => void }) {
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await ppFetch<ReadinessResult>(`/api/pp/inspections/${inspectionId}/readiness`);
      setResult(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load readiness');
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => { void load(); }, [load]);

  async function handleGenerateSummary() {
    setGeneratingSummary(true);
    setSummaryMsg(null);
    setErr(null);
    try {
      await ppFetch(`/api/inspections/${inspectionId}/summary`, { method: 'POST' });
      setSummaryMsg('AI summary generated — re-checking readiness…');
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Summary generation failed');
    } finally {
      setGeneratingSummary(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;

  if (err) return (
    <div className="flex flex-col items-center gap-3 py-12">
      <AlertCircle className="h-8 w-8 text-red-400" />
      <p className="text-sm text-zinc-400">{err}</p>
      <button onClick={load} className="text-xs text-orange-400 hover:text-orange-300 underline">Retry</button>
    </div>
  );

  if (!result) return null;

  const failItems = result.items.filter((i) => i.state === 'fail');
  const warnItems = result.items.filter((i) => i.state === 'warning');
  const needsSummary = failItems.some((i) => i.key === 'ai_summary' || i.detail?.includes('AI summary'));

  const ITEM_ICON = (state: ReadinessItem['state']) => {
    if (state === 'pass') return <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />;
    if (state === 'fail') return <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />;
    return <AlertCircle className="h-4 w-4 text-yellow-400 flex-shrink-0" />;
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-zinc-200">
          {result.overallPass
            ? 'All required items are complete — ready to compile!'
            : 'Some items must be resolved before compiling.'}
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">
          Warnings don't block compilation; failures do.
        </p>
      </div>

      {summaryMsg && (
        <div className="flex items-center gap-2 bg-green-900/20 border border-green-700 text-green-400 rounded-lg px-4 py-2.5 text-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {summaryMsg}
        </div>
      )}

      <div className="space-y-2">
        {result.items.map((item) => (
          <div
            key={item.key}
            className={[
              'flex items-start gap-3 px-4 py-3 rounded-xl border',
              item.state === 'pass' ? 'bg-green-900/10 border-green-900' :
              item.state === 'fail' ? 'bg-red-900/10 border-red-900' :
              'bg-yellow-900/10 border-yellow-900',
            ].join(' ')}
          >
            {ITEM_ICON(item.state)}
            <div className="min-w-0">
              <p className={[
                'text-sm font-medium',
                item.state === 'pass' ? 'text-green-300' :
                item.state === 'fail' ? 'text-red-300' : 'text-yellow-300',
              ].join(' ')}>
                {item.label}
              </p>
              {item.detail && (
                <p className="text-xs text-zinc-500 mt-0.5">{item.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* AI Summary generation shortcut */}
      {needsSummary && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Generate AI Summary</p>
            <p className="text-xs text-zinc-500 mt-0.5">This inspection needs an AI summary before the package can compile.</p>
          </div>
          <button
            onClick={handleGenerateSummary}
            disabled={generatingSummary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-orange-800 text-white rounded-lg transition-colors flex-shrink-0"
          >
            {generatingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {generatingSummary ? 'Generating…' : 'Generate'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Re-check
        </button>
        {result.overallPass && (
          <button
            onClick={onReady}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Compile & Download
// ---------------------------------------------------------------------------

function Step4Compile({ inspectionId }: { inspectionId: string }) {
  const [compiling, setCompiling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lintWarnings, setLintWarnings] = useState<string[]>([]);
  const [versionIndex, setVersionIndex] = useState<number | null>(null);
  const [dismissedLint, setDismissedLint] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function handleCompile() {
    setCompiling(true);
    setErr(null);
    setLintWarnings([]);
    setVersionIndex(null);
    setElapsed(0);
    setDismissedLint(false);

    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      type CompileResp = { versionIndex: number; lint?: { findings?: Array<{ fragmentRef: string; kind: string }> } };
      const data = await ppFetch<CompileResp>(
        `/api/inspections/${inspectionId}/report/compile`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      );
      setVersionIndex(data.versionIndex ?? 0);
      // Collect any lint findings to show as dismissable notice.
      const findings = data.lint?.findings ?? [];
      if (findings.length > 0) {
        setLintWarnings(findings.map((f: { fragmentRef: string; kind: string }) => `${f.fragmentRef}: ${f.kind}`));
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Compilation failed');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setCompiling(false);
    }
  }

  const reportUrl = `/api/pp/inspections/${inspectionId}/report/${versionIndex ?? 0}`;
  const pdfUrl = `/api/pp/inspections/${inspectionId}/report/${versionIndex ?? 0}/pdf`;

  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      {versionIndex === null ? (
        <>
          <div className="h-16 w-16 rounded-2xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
            {compiling
              ? <Loader2 className="h-8 w-8 text-orange-400 animate-spin" />
              : <Download className="h-8 w-8 text-orange-400" />
            }
          </div>
          <div className="space-y-1.5 max-w-sm">
            <h2 className="text-xl font-bold text-white">
              {compiling ? 'Generating your Proof Package…' : 'Ready to Compile'}
            </h2>
            <p className="text-sm text-zinc-400">
              {compiling
                ? `This typically takes 30–90 seconds. ${elapsed > 0 ? `(${elapsed}s elapsed)` : ''}`
                : 'Click the button below to generate your Proof Package. This calls AI to arrange your inspection data into a final report.'}
            </p>
          </div>

          {err && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-4 py-2.5 text-sm max-w-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-left">{err}</span>
            </div>
          )}

          <button
            onClick={handleCompile}
            disabled={compiling}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 disabled:bg-orange-800 disabled:text-orange-400 text-white rounded-lg transition-colors"
          >
            {compiling
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />
            }
            {compiling ? 'Compiling…' : err ? 'Retry' : 'Generate Proof Package'}
          </button>
        </>
      ) : (
        <>
          <div className="h-16 w-16 rounded-2xl bg-green-900/30 border border-green-700 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-green-400" />
          </div>
          <div className="space-y-1.5 max-w-sm">
            <h2 className="text-xl font-bold text-white">Package Ready!</h2>
            <p className="text-sm text-zinc-400">
              Your Proof Package has been compiled. It also appears in My Packages for future reference.
            </p>
          </div>

          {lintWarnings.length > 0 && !dismissedLint && (
            <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-700 text-yellow-400 rounded-lg px-4 py-3 text-sm max-w-md text-left">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">Content Notices</p>
                <p className="text-xs mt-0.5 text-yellow-500">
                  Some AI-generated text may need review before sharing with carriers.
                  Your package is still usable.
                </p>
              </div>
              <button onClick={() => setDismissedLint(true)} className="flex-shrink-0 text-yellow-600 hover:text-yellow-400 text-xs underline">
                Dismiss
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <a
              href={pdfUrl}
              download
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
            <a
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 rounded-lg transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              View Report
            </a>
            <button
              onClick={handleCompile}
              disabled={compiling}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 rounded-lg transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Recompile
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export default function PPWizardPage() {
  const { id: inspectionId } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [creditChecking, setCreditChecking] = useState(true);
  const [creditErr, setCreditErr] = useState<string | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [canceledMsg, setCanceledMsg] = useState(false);

  // On load: check credit status + handle Stripe redirect params
  useEffect(() => {
    if (!inspectionId) return;

    const params = new URLSearchParams(window.location.search);
    const checkoutSession = params.get('checkout_session');
    const checkoutCanceled = params.get('checkout') === 'canceled';

    if (checkoutCanceled) {
      setCanceledMsg(true);
      // Strip query param
      window.history.replaceState(null, '', window.location.pathname);
    }

    async function init() {
      setCreditChecking(true);
      try {
        // If we have a checkout_session, confirm it first
        if (checkoutSession) {
          setConfirmingPayment(true);
          try {
            await ppFetch('/api/pp/packages/checkout/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: checkoutSession, inspectionId }),
            });
            // Strip query param from URL
            window.history.replaceState(null, '', window.location.pathname);
          } catch (e: unknown) {
            setConfirmErr(e instanceof Error ? e.message : 'Could not confirm payment');
          } finally {
            setConfirmingPayment(false);
          }
        }

        // Check credit status — if paid, probe curation+caption state to resume
        // at the earliest incomplete step rather than always landing at Step 1.
        const status = await ppFetch<CreditStatus>(
          `/api/pp/packages/credit-status/${inspectionId}`,
        );
        if (status.paid) {
          try {
            const curation = await ppFetch<CurationState>(
              `/api/${inspectionId}/curation`,
            );
            if (curation.isFinalized) {
              const captions = curation.captions ?? [];
              const allApproved =
                captions.length > 0 &&
                captions.every((c) => c.state === 'approved' || c.state === 'locked');
              // Resume at Step 4 (readiness) if captions are approved, else Step 3.
              setStep(allApproved ? 4 : 3);
            } else {
              setStep(1);
            }
          } catch {
            // Curation fetch failed — start at Step 1 (safe fallback).
            setStep(1);
          }
        }
      } catch (e: unknown) {
        setCreditErr(e instanceof Error ? e.message : 'Failed to check payment status');
      } finally {
        setCreditChecking(false);
      }
    }

    void init();
  }, [inspectionId]);

  if (!inspectionId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-zinc-500">Invalid inspection ID.</p>
      </div>
    );
  }

  if (creditChecking || confirmingPayment) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
        <p className="text-sm text-zinc-500">
          {confirmingPayment ? 'Confirming payment…' : 'Checking payment status…'}
        </p>
      </div>
    );
  }

  const canGoBack = step > 1;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/pp/inspections')}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          My Inspections
        </button>
      </div>

      {/* Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Package Generation Wizard</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Follow each step to build and download your Proof Package.
        </p>
      </div>

      {/* Step progress */}
      <StepHeader current={step} />

      {/* Error banners */}
      {confirmErr && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-4 py-2.5 text-sm mb-4">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Payment confirmation failed: {confirmErr}. If you completed payment, please contact support.
        </div>
      )}
      {creditErr && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 text-red-400 rounded-lg px-4 py-2.5 text-sm mb-4">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {creditErr}
        </div>
      )}
      {canceledMsg && (
        <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg px-4 py-2.5 text-sm mb-4">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Payment was canceled — you can try again below.
        </div>
      )}

      {/* Step content card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        {/* Step header */}
        <div className="flex items-center gap-2 mb-5 pb-4 border-b border-zinc-800">
          {canGoBack && (
            <button
              onClick={() => setStep((s) => (s - 1) as typeof step)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors mr-1"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {(() => {
            const Icon = STEPS[step].icon;
            return (
              <>
                <Icon className="h-5 w-5 text-orange-400" />
                <h2 className="text-base font-semibold text-white">
                  Step {step} — {STEPS[step].title}
                </h2>
              </>
            );
          })()}
        </div>

        {/* Step body */}
        {step === 0 && (
          <Step0Payment
            inspectionId={inspectionId}
            onPaid={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <StepUpload
            inspectionId={inspectionId}
            onContinue={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <Step1Curation
            inspectionId={inspectionId}
            onFinalized={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <Step2Captions
            inspectionId={inspectionId}
            onApproved={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <Step3Readiness
            inspectionId={inspectionId}
            onReady={() => setStep(5)}
          />
        )}
        {step === 5 && (
          <Step4Compile inspectionId={inspectionId} />
        )}
      </div>
    </div>
  );
}
