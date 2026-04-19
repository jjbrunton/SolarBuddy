import { NextResponse } from 'next/server';
import { runRetentionPrune } from '@/lib/db/prune';
import { appendEvent } from '@/lib/events';
import { errorResponse } from '@/lib/api-error';

export async function POST() {
  try {
    const results = runRetentionPrune();
    const summary = results.map((r) => `${r.table}=${r.deleted}`).join(', ');
    const message = `DB retention prune complete (${summary}).`;
    appendEvent({ level: 'info', category: 'retention', message });
    return NextResponse.json({ ok: true, message, results });
  } catch (err) {
    return errorResponse(err);
  }
}
