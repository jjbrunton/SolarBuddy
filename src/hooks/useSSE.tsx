'use client';

import { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { InverterState } from '@/lib/types';
import { INITIAL_STATE } from '@/lib/types';

interface SSEContextValue {
  state: InverterState;
  connected: boolean;
}

const SSEContext = createContext<SSEContextValue>({
  state: INITIAL_STATE,
  connected: false,
});

export function SSEProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InverterState>(INITIAL_STATE);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/events');
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setState({ ...INITIAL_STATE, ...data } as InverterState);
      } catch {
        // Ignore parse errors (e.g. keep-alive pings)
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const value = useMemo(() => ({ state, connected }), [state, connected]);

  return <SSEContext value={value}>{children}</SSEContext>;
}

export function useSSE() {
  return useContext(SSEContext);
}
