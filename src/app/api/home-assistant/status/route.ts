import { NextResponse } from 'next/server';
import { getHomeAssistantStatus } from '@/lib/home-assistant/runtime';

export async function GET() {
  return NextResponse.json(getHomeAssistantStatus());
}
