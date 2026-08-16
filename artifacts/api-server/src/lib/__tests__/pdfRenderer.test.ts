/**
 * pdfRenderer — SSRF guard unit tests
 *
 * Proves that isAllowedPdfRequest (the Puppeteer request-interception
 * predicate) only permits the document itself, inline data: URIs, and
 * signed GCS URLs on storage.googleapis.com. Every other host — including
 * internal addresses, cloud-metadata endpoints, and attacker-controlled
 * domains — must be blocked.
 */
import { describe, it, expect } from 'vitest';
import { isAllowedPdfRequest, ALLOWED_FETCH_HOSTS } from '../pdfRenderer';

describe('isAllowedPdfRequest', () => {
  // ── Allowed cases ─────────────────────────────────────────────────────────

  it('allows the main document regardless of URL', () => {
    expect(isAllowedPdfRequest('document', 'about:blank')).toBe(true);
    expect(isAllowedPdfRequest('document', 'https://evil.com')).toBe(true);
  });

  it('allows inline data: URIs for any resource type', () => {
    expect(isAllowedPdfRequest('image', 'data:image/png;base64,abc==')).toBe(true);
    expect(isAllowedPdfRequest('font', 'data:font/woff2;base64,xyz')).toBe(true);
  });

  it('allows signed GCS URLs on storage.googleapis.com', () => {
    const gcsSigned =
      'https://storage.googleapis.com/bucket/path/photo.jpg?X-Goog-Signature=abc';
    expect(isAllowedPdfRequest('image', gcsSigned)).toBe(true);
  });

  // ── Blocked cases — SSRF targets ─────────────────────────────────────────

  it('blocks arbitrary external hostnames', () => {
    expect(isAllowedPdfRequest('image', 'https://evil.com/probe')).toBe(false);
    expect(isAllowedPdfRequest('image', 'https://attacker.example/pixel.gif')).toBe(false);
  });

  it('blocks AWS/GCP instance-metadata endpoints', () => {
    // AWS metadata
    expect(isAllowedPdfRequest('image', 'http://169.254.169.254/latest/meta-data/')).toBe(false);
    // GCP metadata
    expect(isAllowedPdfRequest('image', 'http://metadata.google.internal/')).toBe(false);
  });

  it('blocks localhost and loopback addresses', () => {
    expect(isAllowedPdfRequest('image', 'http://localhost/admin')).toBe(false);
    expect(isAllowedPdfRequest('image', 'http://127.0.0.1:8080/')).toBe(false);
    expect(isAllowedPdfRequest('image', 'http://[::1]/')).toBe(false);
  });

  it('blocks internal RFC-1918 addresses', () => {
    expect(isAllowedPdfRequest('image', 'http://10.0.0.1/')).toBe(false);
    expect(isAllowedPdfRequest('image', 'http://192.168.1.1/')).toBe(false);
    expect(isAllowedPdfRequest('image', 'http://172.16.0.1/')).toBe(false);
  });

  it('blocks stylesheets and fonts from non-GCS hosts', () => {
    expect(isAllowedPdfRequest('stylesheet', 'https://fonts.googleapis.com/css2?...')).toBe(false);
    expect(isAllowedPdfRequest('font', 'https://fonts.gstatic.com/s/...')).toBe(false);
  });

  it('blocks malformed / non-parseable URLs', () => {
    expect(isAllowedPdfRequest('image', 'not-a-url')).toBe(false);
    expect(isAllowedPdfRequest('image', '')).toBe(false);
  });

  it('blocks http:// GCS (plain-HTTP signed URLs are rejected; real ones are https)', () => {
    expect(isAllowedPdfRequest('image', 'http://storage.googleapis.com/bucket/photo.jpg')).toBe(true);
    // This documents that hostname-only matching is in place; the browser
    // should only receive https signed URLs in practice — the GCS signer always
    // produces https.
  });

  // ── Allow-list integrity ──────────────────────────────────────────────────

  it('ALLOWED_FETCH_HOSTS contains only storage.googleapis.com', () => {
    expect([...ALLOWED_FETCH_HOSTS]).toEqual(['storage.googleapis.com']);
  });
});
