/**
 * Simple fixed-window per-IP rate limiter (in-memory).
 *
 * This is intentionally lightweight — no external dependencies — matching the
 * pattern already used on the Evidence Portal share-code endpoint.  It is
 * suitable for low-traffic auth surfaces where the goal is to slow down
 * brute-force attempts, not to enforce strict SLAs.
 */

import type { Request, Response } from 'express';

interface WindowEntry {
  windowStart: number;
  count: number;
}

export interface RateLimiterOptions {
  /** Length of each window in milliseconds (default: 60 000). */
  windowMs?: number;
  /** Maximum number of requests allowed per IP per window (default: 20). */
  maxRequests?: number;
  /** Maximum number of IPs tracked before a sweep runs (default: 10 000). */
  maxTrackedIps?: number;
  /** Message sent in the 429 JSON body. */
  message?: string;
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxTrackedIps: number;
  private readonly message: string;
  private readonly store = new Map<string, WindowEntry>();

  constructor(opts: RateLimiterOptions = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxRequests = opts.maxRequests ?? 20;
    this.maxTrackedIps = opts.maxTrackedIps ?? 10_000;
    this.message =
      opts.message ?? 'Too many attempts. Please wait a minute and try again.';
  }

  private isLimited(ip: string): boolean {
    const now = Date.now();
    const entry = this.store.get(ip);
    if (!entry || now - entry.windowStart > this.windowMs) {
      // Enforce the cap before inserting a new entry.
      if (this.store.size >= this.maxTrackedIps) {
        // First pass: sweep expired windows (cheapest eviction).
        let swept = false;
        for (const [key, val] of this.store) {
          if (now - val.windowStart > this.windowMs) {
            this.store.delete(key);
            swept = true;
          }
        }
        // Second pass: if still at cap (all entries are active, e.g. a
        // distributed flood), evict the oldest window so the map never
        // grows past its declared bound.
        if (!swept || this.store.size >= this.maxTrackedIps) {
          let oldestKey: string | undefined;
          let oldestStart = Infinity;
          for (const [key, val] of this.store) {
            if (val.windowStart < oldestStart) {
              oldestStart = val.windowStart;
              oldestKey = key;
            }
          }
          if (oldestKey !== undefined) this.store.delete(oldestKey);
        }
      }
      this.store.set(ip, { windowStart: now, count: 1 });
      return false;
    }
    entry.count++;
    return entry.count > this.maxRequests;
  }

  /**
   * Express middleware. Calls next() if the request is within limits,
   * otherwise responds with 429 and does NOT call next().
   */
  middleware() {
    return (req: Request, res: Response, next: () => void): void => {
      const ip = req.ip ?? 'unknown';
      if (this.isLimited(ip)) {
        res.status(429).json({ error: this.message });
        return;
      }
      next();
    };
  }

  /**
   * Imperative guard — returns false and sends 429 if rate-limited.
   * Useful in route handlers that need to run other logic before responding.
   */
  guard(req: Request, res: Response): boolean {
    const ip = req.ip ?? 'unknown';
    if (this.isLimited(ip)) {
      res.status(429).json({ error: this.message });
      return false;
    }
    return true;
  }
}
