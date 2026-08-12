/**
 * /pp/portal — PP Subscriber portal placeholder.
 *
 * The full portal shell is built in a downstream task (PP Subscriber Portal
 * Shell & Account Hub). This page is the landing destination for successful
 * registration, login, and email verification so those flows have a valid
 * redirect target.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

const BASE = '';

interface PPUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  companyId: string;
}
interface PPCompany {
  id: string;
  name: string;
  ppTier: string;
}

export default function PPPortalPlaceholder() {
  const [user, setUser] = useState<PPUser | null>(null);
  const [company, setCompany] = useState<PPCompany | null>(null);
  const [loading, setLoading] = useState(true);

  const params = new URLSearchParams(window.location.search);
  const verified = params.get('verified') === '1';

  useEffect(() => {
    fetch(`${BASE}/api/pp/me`, { credentials: 'include' })
      .then(async (r) => {
        if (r.ok) {
          const body = await r.json();
          setUser(body.user);
          setCompany(body.company);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!user) {
    // Not authenticated — send to login.
    window.location.href = '/rooftrax-web/pp/login';
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 gap-4">
      {verified && (
        <div className="flex items-center gap-2 bg-green-900/20 border border-green-700 text-green-400 rounded-lg px-4 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4" /> Email verified successfully.
        </div>
      )}
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">Welcome, {company?.name ?? 'your company'}</h1>
        <p className="text-zinc-400 text-sm">Company ID: <span className="font-mono text-zinc-300">{user.companyId}</span></p>
        {!user.emailVerified && (
          <p className="text-amber-400 text-sm">Check your inbox to verify your email address.</p>
        )}
        <p className="text-zinc-500 text-xs mt-4">
          The Proof Package portal is coming soon. Your account is ready.
        </p>
      </div>
      <button
        onClick={() => { fetch('/api/pp/logout', { method: 'POST', credentials: 'include' }).then(() => { window.location.href = '/rooftrax-web/pp/login'; }); }}
        className="text-zinc-500 hover:text-zinc-300 text-xs underline mt-4"
      >
        Sign out
      </button>
    </div>
  );
}
