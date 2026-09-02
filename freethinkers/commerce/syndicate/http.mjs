/**
 * HTTP layer for provider APIs — the part that keeps a 180-piece sync alive.
 *
 * Both Printful and Printify rate-limit, and a batch sync WILL hit those
 * limits. The failure mode to avoid is the 3am one: 140 products created, a
 * burst of 429s, and a crashed script that can't tell you where it stopped.
 * So this layer does three things and nothing else:
 *
 *   1. A token bucket per provider that spends requests slower than the
 *      documented ceiling, so 429s are the exception rather than the plan.
 *   2. Retries with exponential backoff + jitter for 429 / 5xx / network
 *      errors — honouring Retry-After when the provider sends one.
 *   3. Errors that carry the request context, so a failure names the product
 *      and endpoint instead of just "Too Many Requests".
 *
 * 4xx other than 429 do NOT retry: a bad payload stays bad no matter how
 * politely you resend it, and retrying it just burns the budget.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimiter {
  /** @param perMinute sustained request budget; keep under the documented cap */
  constructor(perMinute) {
    this.interval = 60_000 / perMinute;
    this.nextAt = 0;
  }
  async take() {
    const now = Date.now();
    const wait = this.nextAt - now;
    this.nextAt = Math.max(now, this.nextAt) + this.interval;
    if (wait > 0) await sleep(wait);
  }
}

export class ApiError extends Error {
  constructor(message, { status, method, url, body, attempt } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.body = body;
    this.attempt = attempt;
  }
}

/**
 * @param {object} opts
 * @param {RateLimiter} opts.limiter
 * @param {number} [opts.maxAttempts=6]
 * @param {number} [opts.baseDelayMs=1000]
 * @param {(msg:string)=>void} [opts.log]
 */
export function makeClient({ limiter, maxAttempts = 6, baseDelayMs = 1000, log = () => {} }) {
  return async function request(method, url, { headers = {}, json, form } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await limiter.take();

      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(form !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
            ...headers,
          },
          body: json !== undefined ? JSON.stringify(json)
              : form !== undefined ? new URLSearchParams(form).toString()
              : undefined,
        });
      } catch (e) {
        // Network-level failure — retryable.
        lastErr = new ApiError(`network error: ${e.message}`, { method, url, attempt });
        const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
        log(`  ↻ ${method} ${url} network error (attempt ${attempt}/${maxAttempts}), waiting ${Math.round(delay)}ms`);
        await sleep(delay);
        continue;
      }

      if (res.ok) {
        const text = await res.text();
        try { return text ? JSON.parse(text) : {}; }
        catch { return { raw: text }; }
      }

      const bodyText = await res.text().catch(() => '');

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
        lastErr = new ApiError(`HTTP ${res.status}`, { status: res.status, method, url, body: bodyText.slice(0, 400), attempt });
        log(`  ↻ ${method} ${url} → ${res.status} (attempt ${attempt}/${maxAttempts}), waiting ${Math.round(delay)}ms`);
        await sleep(delay);
        continue;
      }

      // Non-retryable client error: fail fast with everything a human needs.
      throw new ApiError(`HTTP ${res.status} ${method} ${url}\n${bodyText.slice(0, 800)}`, {
        status: res.status, method, url, body: bodyText.slice(0, 800), attempt,
      });
    }
    throw lastErr ?? new ApiError(`exhausted ${maxAttempts} attempts`, { method, url });
  };
}
