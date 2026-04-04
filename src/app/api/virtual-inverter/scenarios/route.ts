import { NextResponse } from 'next/server';
import { listAvailableVirtualScenarios } from '@/lib/virtual-inverter/runtime';

export async function GET() {
  return NextResponse.json({ scenarios: listAvailableVirtualScenarios() });
}
