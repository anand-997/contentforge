// lib/client/networkError.ts
// Classifies a raw fetch() Promise rejection (never got an HTTP response) as
// opposed to an app-thrown Error or a resolved-but-non-ok Response. Browsers
// report this failure mode with terse, engine-specific messages — WebKit
// (Safari, and Chrome-on-iOS, which is WebKit-based per Apple's policy) says
// "Load failed"; Chromium says "Failed to fetch"; Firefox says "NetworkError
// when attempting to fetch resource". A long-running fetch is especially
// likely to hit this on mobile: locking the screen suspends the tab's
// network connections, and the in-flight request rejects when the tab
// resumes.
const TRANSIENT_NETWORK_MESSAGES = [
  "load failed",
  "failed to fetch",
  "networkerror when attempting to fetch resource",
];

export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const message = err.message.toLowerCase();
  return TRANSIENT_NETWORK_MESSAGES.some((m) => message.includes(m));
}

/**
 * fetch() that retries only a transient network-layer failure (the request
 * never got a response) — never a resolved Response (ok or not) and never an
 * error the caller's own code threw. Safe to use for idempotent-enough calls
 * where redoing the request on a dropped connection is harmless.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  attempts = 2,
  delayMs = 1200,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * 1.5 ** attempt));
    }
  }
  throw lastErr;
}
