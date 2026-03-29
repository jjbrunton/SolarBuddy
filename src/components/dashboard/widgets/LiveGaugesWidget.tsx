'use client';

import LiveGauges from '@/components/LiveGauges';
import { useSSE } from '@/hooks/useSSE';

export default function LiveGaugesWidget() {
  const { state, connected } = useSSE();
  return <LiveGauges state={state} connected={connected} />;
}
