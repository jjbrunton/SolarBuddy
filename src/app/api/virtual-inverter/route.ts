import { NextResponse } from 'next/server';
import {
  disableVirtualInverter,
  enableVirtualInverter,
  getVirtualInverterStatus,
  isVirtualModeEnabled,
  pauseVirtualInverter,
  resetVirtualInverter,
  startVirtualInverter,
} from '@/lib/virtual-inverter/runtime';

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: isVirtualModeEnabled() ? 'virtual' : 'real',
    ...getVirtualInverterStatus(),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: 'enable' | 'disable' | 'start' | 'pause' | 'reset';
    scenarioId?: string;
    speed?: string;
    startSoc?: number;
    loadMultiplier?: number;
  };

  const action = body.action ?? 'start';

  switch (action) {
    case 'enable':
      enableVirtualInverter({
        scenarioId: body.scenarioId,
        speed: body.speed,
        startSoc: body.startSoc,
        loadMultiplier: body.loadMultiplier,
      });
      break;
    case 'disable':
      disableVirtualInverter();
      break;
    case 'pause':
      pauseVirtualInverter();
      break;
    case 'reset':
      resetVirtualInverter({
        startSoc: body.startSoc,
        loadMultiplier: body.loadMultiplier,
      });
      break;
    case 'start':
    default:
      if (!isVirtualModeEnabled()) {
        enableVirtualInverter({
          scenarioId: body.scenarioId,
          speed: body.speed,
          startSoc: body.startSoc,
          loadMultiplier: body.loadMultiplier,
        });
      }
      if (body.startSoc !== undefined || body.loadMultiplier !== undefined) {
        resetVirtualInverter({
          startSoc: body.startSoc,
          loadMultiplier: body.loadMultiplier,
        });
      }
      startVirtualInverter();
      break;
  }

  return NextResponse.json({
    ok: true,
    mode: isVirtualModeEnabled() ? 'virtual' : 'real',
    ...getVirtualInverterStatus(),
  });
}
