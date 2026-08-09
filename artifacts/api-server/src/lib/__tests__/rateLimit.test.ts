import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../rateLimit';
import type { Request, Response } from 'express';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeReq(ip: string): Request {
  return { ip } as unknown as Request;
}

interface CapturedResponse {
  status: number | undefined;
  body: unknown;
}

function makeRes(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: undefined, body: undefined };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('RateLimiter.guard()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit', () => {
    const limiter = new RateLimiter({ maxRequests: 3 });
    for (let i = 0; i < 3; i++) {
      const { res, captured } = makeRes();
      expect(limiter.guard(makeReq('1.2.3.4'), res)).toBe(true);
      expect(captured.status).toBeUndefined();
    }
  });

  it('blocks the request that exceeds the limit and returns 429', () => {
    const limiter = new RateLimiter({ maxRequests: 3 });
    for (let i = 0; i < 3; i++) limiter.guard(makeReq('1.2.3.4'), makeRes().res);
    const { res, captured } = makeRes();
    expect(limiter.guard(makeReq('1.2.3.4'), res)).toBe(false);
    expect(captured.status).toBe(429);
  });

  it('one IP cannot exhaust another IP quota', () => {
    const limiter = new RateLimiter({ maxRequests: 2 });
    // Exhaust IP A
    for (let i = 0; i < 5; i++) limiter.guard(makeReq('10.0.0.1'), makeRes().res);
    // IP B should still be allowed
    const { res, captured } = makeRes();
    expect(limiter.guard(makeReq('10.0.0.2'), res)).toBe(true);
    expect(captured.status).toBeUndefined();
  });

  it('distinct IPs each get their own independent window', () => {
    const limiter = new RateLimiter({ maxRequests: 1 });
    // Both IPs exhaust their own windows
    limiter.guard(makeReq('192.168.1.1'), makeRes().res);
    limiter.guard(makeReq('192.168.1.2'), makeRes().res);
    // Second request from each should be blocked independently
    const { res: resA, captured: capA } = makeRes();
    expect(limiter.guard(makeReq('192.168.1.1'), resA)).toBe(false);
    expect(capA.status).toBe(429);
    const { res: resB, captured: capB } = makeRes();
    expect(limiter.guard(makeReq('192.168.1.2'), resB)).toBe(false);
    expect(capB.status).toBe(429);
    // A third IP is unaffected
    const { res: resC, captured: capC } = makeRes();
    expect(limiter.guard(makeReq('192.168.1.3'), resC)).toBe(true);
    expect(capC.status).toBeUndefined();
  });

  it('resets the window after windowMs has elapsed', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
    // Exhaust
    limiter.guard(makeReq('5.5.5.5'), makeRes().res);
    limiter.guard(makeReq('5.5.5.5'), makeRes().res);
    const { res: blockedRes, captured: blockedCap } = makeRes();
    expect(limiter.guard(makeReq('5.5.5.5'), blockedRes)).toBe(false);
    expect(blockedCap.status).toBe(429);
    // Advance past the window
    vi.advanceTimersByTime(61_000);
    const { res: allowedRes, captured: allowedCap } = makeRes();
    expect(limiter.guard(makeReq('5.5.5.5'), allowedRes)).toBe(true);
    expect(allowedCap.status).toBeUndefined();
  });

  it('never grows past maxTrackedIps even when all windows are active', () => {
    vi.useFakeTimers();
    const maxTrackedIps = 5;
    const limiter = new RateLimiter({ maxRequests: 100, maxTrackedIps, windowMs: 60_000 });
    // Fill to capacity with active (non-expired) windows
    for (let i = 0; i < maxTrackedIps; i++) {
      limiter.guard(makeReq(`10.0.0.${i}`), makeRes().res);
      // Advance slightly so each IP has a different windowStart
      vi.advanceTimersByTime(10);
    }
    // Adding one more IP should still succeed (oldest is evicted internally)
    const { res, captured } = makeRes();
    expect(limiter.guard(makeReq('10.0.1.0'), res)).toBe(true);
    expect(captured.status).toBeUndefined();
  });
});

describe('RateLimiter.middleware()', () => {
  it('calls next() when under the limit', () => {
    const limiter = new RateLimiter({ maxRequests: 5 });
    const mw = limiter.middleware();
    let called = false;
    const { res } = makeRes();
    mw(makeReq('1.1.1.1'), res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('does NOT call next() and responds 429 when over the limit', () => {
    const limiter = new RateLimiter({ maxRequests: 1 });
    const mw = limiter.middleware();
    mw(makeReq('2.2.2.2'), makeRes().res, () => {});
    mw(makeReq('2.2.2.2'), makeRes().res, () => {});
    let called = false;
    const { res, captured } = makeRes();
    mw(makeReq('2.2.2.2'), res, () => { called = true; });
    expect(called).toBe(false);
    expect(captured.status).toBe(429);
  });
});
