import { NextRequest } from 'next/server';
import { requireAuth, successResponse, errorResponse } from '@/lib/auth';
import { aiUsageToday } from '@/lib/aiClassifier';

/**
 * Today's use of the free AI quota, for staff: counts and limits only. No
 * report text is kept by the AI reader, so none can be returned here, and the
 * API key is never part of the response.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('status' in auth) return auth;
  try {
    return successResponse(await aiUsageToday());
  } catch (err) {
    console.error('[AI usage]', err instanceof Error ? err.message : 'failed');
    return errorResponse('Could not read AI usage', 500);
  }
}
