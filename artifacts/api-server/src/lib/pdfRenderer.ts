/**
 * HTML → PDF renderer using headless Chrome via Puppeteer.
 *
 * Puppeteer is externalized in build.mjs so it's loaded from node_modules at
 * runtime (not inlined by esbuild). The Chrome binary is downloaded during
 * `pnpm install` and cached at ~/.cache/puppeteer.
 *
 * SSRF mitigation
 * ───────────────
 * `renderHtmlToPdf` enables Puppeteer request interception and only allows
 * outbound requests whose hostname is in ALLOWED_FETCH_HOSTS. Every legitimate
 * resource in a compiled Proof Package (photos, logo, signature) is a signed
 * GCS URL on storage.googleapis.com. Arbitrary URLs from legacy blobs or
 * crafted report objects are aborted before the browser can fetch them.
 */

/**
 * Hostnames headless Chrome is permitted to contact while rendering a PDF.
 * All signed object-storage URLs produced by getSignedDownloadUrl come from
 * storage.googleapis.com; nothing else is expected in a compiled report blob.
 *
 * Exported for unit tests — do not import elsewhere.
 */
export const ALLOWED_FETCH_HOSTS = new Set(['storage.googleapis.com']);

/**
 * Returns true when headless Chrome should be allowed to fetch `url` while
 * rendering a Proof Package PDF.
 *
 * - `document` type: always allowed (it is the HTML we injected via setContent).
 * - `data:` URIs: always allowed (inline fonts / base64 images).
 * - All other types: allowed only if the URL's hostname is in ALLOWED_FETCH_HOSTS.
 *
 * Exported so the pure-function logic can be unit-tested without a real browser.
 */
export function isAllowedPdfRequest(resourceType: string, url: string): boolean {
  if (resourceType === 'document') return true;
  if (url.startsWith('data:')) return true;
  try {
    const { hostname } = new URL(url);
    return ALLOWED_FETCH_HOSTS.has(hostname);
  } catch {
    // Malformed URL — block it.
    return false;
  }
}

/** Render an HTML string to a PDF buffer using headless Chrome. */
export async function renderHtmlToPdf(html: string, timeoutMs = 60_000): Promise<Buffer> {
  // Dynamic import keeps the esbuild external boundary intact.
  const puppeteer = await import('puppeteer');

  // NOTE: --no-sandbox is required in containerised Linux environments
  // (Replit, Cloud Run, GKE unprivileged pods, etc.) that have no user
  // namespaces available. The primary SSRF mitigation is request interception
  // (below), not the Chrome process sandbox.
  const browser = await puppeteer.launch({
    headless: true,
    timeout: timeoutMs,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(timeoutMs);

    // ── SSRF guard ──────────────────────────────────────────────────────────
    // Block every outbound request that isn't the document itself, an inline
    // data: URI, or a signed GCS URL. This prevents a crafted report blob
    // with arbitrary photo/logo URLs from making the API host probe internal
    // or attacker-controlled endpoints.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (isAllowedPdfRequest(req.resourceType(), req.url())) {
        req.continue();
      } else {
        req.abort('failed');
      }
    });
    // ── end SSRF guard ──────────────────────────────────────────────────────

    // Inject the full HTML, then wait for GCS image fetches to complete.
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: timeoutMs,
    });
    // waitForNetworkIdle ensures signed photo URLs have been fetched before
    // we render the PDF. Best-effort: we continue even if some requests are
    // still in flight after idleTime ms.
    await page.waitForNetworkIdle({ timeout: timeoutMs, idleTime: 500 }).catch(() => {
      /* best-effort */
    });

    const pdfUint8 = await page.pdf({
      format: 'Letter',
      printBackground: true,
      // The template supplies its own padding; pass zeroes to avoid doubling.
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return Buffer.from(pdfUint8);
  } finally {
    await browser.close().catch(() => {/* best-effort */});
  }
}
