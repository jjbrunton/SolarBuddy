import { NextResponse } from 'next/server';
import { testHomeAssistantConnection } from '@/lib/home-assistant/runtime';

export async function POST() {
  const result = await testHomeAssistantConnection();
  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json(result);
}
