'use client';

import { useEffect } from 'react';

/**
 * When the server says a session has ended (signed out on another device, a
 * password changed, an account deactivated - lib/sessions.ts), the page stops
 * there: the cookie is cleared and the person is taken to the right sign-in
 * page, instead of staying on a screen whose every request now fails.
 * Watches SafeComm's own /api/ answers only; renders nothing.
 */
let installed = false;

export default function SessionWatch() {
  useEffect(() => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    const original = window.fetch.bind(window);
    let leaving = false;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      if (res.status !== 401 || leaving) return res;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const sameApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
      if (!sameApi) return res;
      const body = await res.clone().json().catch(() => null) as { code?: string } | null;
      if (body?.code !== 'SESSION_ENDED') return res;
      leaving = true;
      const path = window.location.pathname;
      const resident = path.startsWith('/resident');
      await original(resident ? '/api/auth/resident-logout' : '/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
      window.location.assign(resident ? '/resident-login?ended=1' : path.startsWith('/vawc') ? '/vawc-login?ended=1' : '/login?ended=1');
      return res;
    };
  }, []);
  return null;
}
