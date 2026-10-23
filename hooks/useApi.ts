'use client';

import useSWR, { mutate } from 'swr';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(res => {
    if (!res.ok) throw new Error('API error');
    return res.json().then(d => d.data);
  });

export function useDashboardStats() {
  return useSWR('/api/dashboard/stats', fetcher, { refreshInterval: 30000 });
}

export function useActivities(limit = 10) {
  return useSWR(`/api/activities?limit=${limit}`, fetcher, { refreshInterval: 15000 });
}

export function useNotifications(limit = 50) {
  return useSWR(`/api/notifications?limit=${limit}`, fetcher, { refreshInterval: 30000 });
}

export function useCases(params?: Record<string, string | number>) {
  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return useSWR(`/api/cases${query}`, fetcher);
}

export function useCaseStats() {
  return useSWR('/api/cases/stats', fetcher, { refreshInterval: 60000 });
}

export function useReports(params?: Record<string, string | number>) {
  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return useSWR(`/api/reports${query}`, fetcher);
}

export function useReportStats() {
  return useSWR('/api/reports/stats', fetcher, { refreshInterval: 60000 });
}

export function useResidents(params?: Record<string, string | number>) {
  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return useSWR(`/api/residents${query}`, fetcher);
}

export function useAnalytics() {
  return useSWR('/api/analytics', fetcher, { refreshInterval: 60000 });
}

export function useAlerts() {
  return useSWR('/api/alerts', fetcher, { refreshInterval: 60000 });
}

export function useMessages(folder: 'inbox' | 'sent' = 'inbox', page = 1) {
  return useSWR(`/api/messages?folder=${folder}&page=${page}`, fetcher, { refreshInterval: 15000 });
}

export function useUsers() {
  return useSWR('/api/users', fetcher);
}

export function useCurrentUser() {
  return useSWR('/api/auth/me', fetcher);
}

/** Risk analytics for a desk. 'vawc' asks for that desk's caseload only. */
export function useAIStats(scope: 'all' | 'vawc' = 'all') {
  return useSWR(
    `/api/ai/stats${scope === 'vawc' ? '?scope=vawc' : ''}`,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export function useCaseDetail(id: string | null) {
  return useSWR(id ? `/api/cases/${id}` : null, fetcher, { revalidateOnFocus: false });
}

export function refreshNotifications() {
  mutate('/api/notifications?limit=50');
}

export function refreshMessages() {
  mutate('/api/messages?folder=inbox&page=1');
  mutate('/api/messages?folder=sent&page=1');
}
