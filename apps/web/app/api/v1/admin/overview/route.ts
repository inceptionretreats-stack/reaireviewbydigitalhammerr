import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/require-admin';
import { loadOverview } from '@/lib/admin/businesses';

export const runtime = 'nodejs';

/** ADMIN-01: the platform dashboard's numbers. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await loadOverview(db()));
}
