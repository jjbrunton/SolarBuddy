'use client';

import { useState, useEffect, useRef } from 'react';
import type { InverterState } from '@/lib/state';

const INITIAL_STATE: InverterState = {
  battery_soc: null,
  pv_power: null,
  grid_power: null,
  load_power: null,
  battery_power: null,
  work_mode: null,
  mqtt_connected: false,
  last_updated: null,
};

export function useSSE() {
  const [state, setState] = useState<InverterState>(INITIAL_STATE);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/events');
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as InverterState;
        setState(data);
      } catch {
        // Ignore parse errors (e.g. keep-alive pings)
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  return { state, connected };
}
