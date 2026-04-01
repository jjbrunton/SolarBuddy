'use client';

import { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { InverterState } from '@/lib/types';
import { INITIAL_STATE } from '@/lib/types';
import {
  hasTelemetryData,
  mergeIncomingTelemetryState,
  parseCachedTelemetryPayload,
} from '@/lib/inverter/liveTelemetry';

interface SSEContextValue {
  state: InverterState;
  connected: boolean;
  hasTelemetry: boolean;
  showingCachedTelemetry: boolean;
  cachedTelemetryAt: string | null;
}

const TELEMETRY_CACHE_KEY = 'solarbuddy:last-live-telemetry';

function readCachedTelemetry() {
  try {
    return parseCachedTelemetryPayload(window.localStorage.getItem(TELEMETRY_CACHE_KEY));
  } catch {
    return null;
  }
}

function writeCachedTelemetry(state: InverterState) {
  try {
    const savedAt = state.last_updated ?? new Date().toISOString();
    window.localStorage.setItem(
      TELEMETRY_CACHE_KEY,
      JSON.stringify({ savedAt, state })
    );
    return savedAt;
  } catch {
    return state.last_updated ?? null;
  }
}

const SSEContext = createContext<SSEContextValue>({
  state: INITIAL_STATE,
  connected: false,
  hasTelemetry: false,
  showingCachedTelemetry: false,
  cachedTelemetryAt: null,
});

export function SSEProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InverterState>(INITIAL_STATE);
  const [connected, setConnected] = useState(false);
  const [showingCachedTelemetry, setShowingCachedTelemetry] = useState(false);
  const [cachedTelemetryAt, setCachedTelemetryAt] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const stateRef = useRef(INITIAL_STATE);

  function commitState(nextState: InverterState) {
    stateRef.current = nextState;
    setState(nextState);
  }

  useEffect(() => {
    const cached = readCachedTelemetry();
    if (cached && hasTelemetryData(cached.state)) {
      commitState(cached.state);
      setShowingCachedTelemetry(true);
      setCachedTelemetryAt(cached.savedAt);
    }

    const es = new EventSource('/api/events');
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const incoming = { ...INITIAL_STATE, ...data } as InverterState;
        const merged = mergeIncomingTelemetryState(stateRef.current, incoming);

        if (!merged.showingCachedTelemetry && hasTelemetryData(incoming)) {
          const savedAt = writeCachedTelemetry(incoming);
          setCachedTelemetryAt(savedAt);
        }

        commitState(merged.state);
        setShowingCachedTelemetry(merged.showingCachedTelemetry);

        if (!merged.showingCachedTelemetry && !hasTelemetryData(incoming)) {
          setCachedTelemetryAt(null);
        }
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

  const value = useMemo(
    () => ({
      state,
      connected,
      hasTelemetry: hasTelemetryData(state),
      showingCachedTelemetry,
      cachedTelemetryAt,
    }),
    [state, connected, showingCachedTelemetry, cachedTelemetryAt]
  );

  return <SSEContext value={value}>{children}</SSEContext>;
}

export function useSSE() {
  return useContext(SSEContext);
}
