'use client';

import { EnergyFlowDiagram } from '@/components/EnergyFlowDiagram';
import { useSSE } from '@/hooks/useSSE';

export default function EnergyFlowWidget() {
  const { state } = useSSE();
  return <EnergyFlowDiagram state={state} />;
}
