/**
 * /pp/portal — PP Subscriber portal placeholder.
 *
 * The full portal shell is built in a downstream task (PP Subscriber Portal
 * Shell & Account Hub). This page is the landing destination for successful
 * registration, login, and email verification so those flows have a valid
 * redirect target.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

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

  // Authenticated — redirect to the inspections page (entry point of the PP portal).
  // Preserve the ?verified=1 param so the inspections page can show the email-verified banner.
  const target = verified
    ? '/rooftrax-web/pp/inspections?verified=1'
    : '/rooftrax-web/pp/inspections';
  window.location.href = target;
  return null;
}
