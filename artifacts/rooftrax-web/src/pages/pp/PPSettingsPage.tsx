/**
 * /pp/settings — Account Settings
 *
 * Lets the company admin update company name, primary contact name, billing
 * email, and logo. Shows the company's short ID for rep onboarding.
 * Includes a read-only "Upgrade to Full CRM" call-to-action.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Loader2, Upload } from 'lucide-react';
import type { PPUser, PPCompany } from '@/components/layout/PPProtectedRoute';

interface FormState {
  companyName: string;
  firstName: string;
  lastName: string;
  billingEmail: string;
}

export default function PPSettingsPage() {
  const [user, setUser] = useState<PPUser | null>(null);
  const [company, setCompany] = useState<PPCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ companyName: '', firstName: '', lastName: '', billingEmail: '' });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load PP session
  useEffect(() => {
    fetch('/api/pp/me', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return;
        const body = await r.json() as { user: PPUser; company: PPCompany };
        setUser(body.user);
        setCompany(body.company);
        // Use the server-signed URL for preview (PP users lack CRM storage.read_private)
        setLogoUrl(body.company.logoSignedUrl ?? null);
        setForm({
          companyName: body.company.name,
          firstName: body.user.firstName ?? '',
          lastName: body.user.lastName ?? '',
          billingEmail: body.user.email ?? '',
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      const res = await fetch('/api/pp/company', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName.trim() || undefined,
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
          billingEmail: form.billingEmail.trim() || undefined,
        }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to save');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setLogoUploading(true);
    try {
      // 1. Get a signed upload URL
      const urlRes = await fetch('/api/pp/upload-url', { credentials: 'include' });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

      // 2. PUT the file to object storage
      const putRes = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      if (!putRes.ok) throw new Error('File upload failed');

      // 3. Update the company logo
      const patchRes = await fetch('/api/pp/company/logo', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectPath }),
      });
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to update logo');
      }

      // 4. Re-fetch /api/pp/me to get the fresh signed read URL for preview
      const meRes = await fetch('/api/pp/me', { credentials: 'include' });
      if (meRes.ok) {
        const meBody = await meRes.json() as { user: PPUser; company: PPCompany };
        setLogoUrl(meBody.company.logoSignedUrl ?? null);
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleCopyId = () => {
    if (company?.id) {
      void navigator.clipboard.writeText(company.id).then(() => {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Account Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">Manage your company details and contact information.</p>
      </div>

      {/* Company ID */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Company ID</p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-orange-400 tracking-wider">{company?.id}</span>
          <button
            onClick={handleCopyId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            {copiedId ? (
              <><CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> Copied</>
            ) : (
              <><Copy className="h-3.5 w-3.5" /> Copy</>
            )}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Share this ID with your field reps so they can link to your company in the mobile app.
        </p>
      </div>

      {/* Settings form */}
      <form onSubmit={handleSave} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
        <p className="text-sm font-semibold text-zinc-200">Company Information</p>

        {saveError && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="flex items-center gap-2 bg-green-900/20 border border-green-800 text-green-400 rounded-lg px-4 py-3 text-sm">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Settings saved successfully.
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-company-name">
            Company Name
          </label>
          <input
            id="pp-company-name"
            type="text"
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            placeholder="Your company name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-first-name">
              First Name
            </label>
            <input
              id="pp-first-name"
              type="text"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="First"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-last-name">
              Last Name
            </label>
            <input
              id="pp-last-name"
              type="text"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              placeholder="Last"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-400" htmlFor="pp-billing-email">
            Billing Email
          </label>
          <input
            id="pp-billing-email"
            type="email"
            value={form.billingEmail}
            onChange={(e) => setForm((f) => ({ ...f, billingEmail: e.target.value }))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            placeholder="billing@yourcompany.com"
          />
          <p className="text-[11px] text-zinc-600">This is also your login email.</p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      {/* Logo */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-zinc-200">Company Logo</p>
        <p className="text-xs text-zinc-500">
          Uploaded to your Proof Package letterhead. PNG or JPG, max 4 MB.
        </p>

        <div className="flex items-center gap-4">
          {/* Logo preview */}
          {logoUrl ? (
            <div className="h-16 w-16 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 flex-shrink-0">
              <img
                src={logoUrl}
                alt="Company logo"
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="h-16 w-16 rounded-lg border border-dashed border-zinc-700 bg-zinc-800 flex-shrink-0 flex items-center justify-center">
              <Upload className="h-6 w-6 text-zinc-600" />
            </div>
          )}

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLogoUpload(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={logoUploading}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {logoUploading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
              ) : (
                <><Upload className="h-3.5 w-3.5" /> {logoUrl ? 'Replace Logo' : 'Upload Logo'}</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Upgrade CTA */}
      <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-200">Upgrade to Full CRM</p>
            <p className="text-xs text-zinc-500 mt-1">
              Get access to the full RoofTrax CRM — lead pipelines, team management, insurance
              workflows, and more.
            </p>
          </div>
        </div>
        <a
          href="/rooftrax-web/pricing"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-zinc-600 hover:border-zinc-400 text-zinc-300 hover:text-zinc-100 rounded-lg transition-colors"
        >
          View upgrade options →
        </a>
      </div>
    </div>
  );
}
