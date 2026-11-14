'use client';

/**
 * POST a JSON body and report how much of it has been sent (0-100) - fetch
 * cannot report upload progress, XMLHttpRequest can. Resolves with the status
 * and the parsed JSON (an empty object when the answer is not JSON, e.g. a
 * host's "payload too large" page); rejects only when the request never got an
 * answer (offline, connection dropped).
 */
export function postWithProgress(url: string, body: string, onProgress: (percent: number) => void): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = e => { if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100))); };
    xhr.upload.onload = () => onProgress(100);
    xhr.onload = () => {
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON */ }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.send(body);
  });
}

/** A key for one submission of a form: random, URL-safe, 8-64 characters. */
export function newSubmissionKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('') || `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
