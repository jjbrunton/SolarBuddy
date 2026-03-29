'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings2, RotateCcw, Plus, X } from 'lucide-react';
import { WidgetWrapper } from './WidgetWrapper';

export interface WidgetDefinition {
  id: string;
  label: string;
  component: React.ComponentType;
}

interface WidgetState {
  id: string;
  visible: boolean;
}

const STORAGE_KEY = 'sb-dashboard-layout';

function loadLayout(allIds: string[]): WidgetState[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: WidgetState[] = JSON.parse(stored);
      // Merge: keep stored order/visibility, add new widgets at the end
      const storedIds = new Set(parsed.map((w) => w.id));
      const result = parsed.filter((w) => allIds.includes(w.id));
      for (const id of allIds) {
        if (!storedIds.has(id)) result.push({ id, visible: true });
      }
      return result;
    }
  } catch { /* ignore */ }
  return allIds.map((id) => ({ id, visible: true }));
}

function saveLayout(layout: WidgetState[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch { /* ignore */ }
}

export function DashboardGrid({ widgets }: { widgets: WidgetDefinition[] }) {
  const [layout, setLayout] = useState<WidgetState[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setLayout(loadLayout(widgets.map((w) => w.id)));
  }, [widgets]);

  const updateLayout = useCallback((next: WidgetState[]) => {
    setLayout(next);
    saveLayout(next);
  }, []);

  const moveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const next = [...layout];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      updateLayout(next);
    },
    [layout, updateLayout],
  );

  const moveDown = useCallback(
    (index: number) => {
      if (index >= layout.length - 1) return;
      const next = [...layout];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      updateLayout(next);
    },
    [layout, updateLayout],
  );

  const toggleVisibility = useCallback(
    (id: string) => {
      updateLayout(layout.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
    },
    [layout, updateLayout],
  );

  const resetLayout = useCallback(() => {
    const defaultLayout = widgets.map((w) => ({ id: w.id, visible: true }));
    updateLayout(defaultLayout);
  }, [widgets, updateLayout]);

  const widgetMap = new Map(widgets.map((w) => [w.id, w]));
  const visibleWidgets = layout.filter((w) => w.visible);
  const hiddenWidgets = layout.filter((w) => !w.visible);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-sb-text">Dashboard</h1>
        <button
          onClick={() => setEditing(!editing)}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            editing
              ? 'bg-sb-warning text-white'
              : 'bg-sb-card text-sb-text-muted hover:bg-sb-active hover:text-sb-text'
          }`}
        >
          {editing ? <X size={14} /> : <Settings2 size={14} />}
          {editing ? 'Done' : 'Edit Dashboard'}
        </button>
      </div>

      {/* Edit mode: reset + add hidden widgets */}
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={resetLayout}
            className="flex items-center gap-1 rounded-md bg-sb-card px-3 py-1.5 text-xs text-sb-text-muted hover:bg-sb-active"
          >
            <RotateCcw size={12} />
            Reset Layout
          </button>
          {hiddenWidgets.map((hw) => {
            const def = widgetMap.get(hw.id);
            if (!def) return null;
            return (
              <button
                key={hw.id}
                onClick={() => toggleVisibility(hw.id)}
                className="flex items-center gap-1 rounded-md border border-dashed border-sb-border bg-sb-card px-3 py-1.5 text-xs text-sb-text-muted hover:border-sb-accent hover:text-sb-text"
              >
                <Plus size={12} />
                {def.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Render visible widgets */}
      {visibleWidgets.map((ws, index) => {
        const def = widgetMap.get(ws.id);
        if (!def) return null;
        const Component = def.component;
        return (
          <WidgetWrapper
            key={ws.id}
            id={ws.id}
            title={def.label}
            editing={editing}
            isFirst={index === 0}
            isLast={index === visibleWidgets.length - 1}
            onMoveUp={() => {
              const layoutIdx = layout.findIndex((w) => w.id === ws.id);
              // Find previous visible widget in layout
              for (let i = layoutIdx - 1; i >= 0; i--) {
                if (layout[i].visible) {
                  const next = [...layout];
                  [next[i], next[layoutIdx]] = [next[layoutIdx], next[i]];
                  updateLayout(next);
                  break;
                }
              }
            }}
            onMoveDown={() => {
              const layoutIdx = layout.findIndex((w) => w.id === ws.id);
              // Find next visible widget in layout
              for (let i = layoutIdx + 1; i < layout.length; i++) {
                if (layout[i].visible) {
                  const next = [...layout];
                  [next[layoutIdx], next[i]] = [next[i], next[layoutIdx]];
                  updateLayout(next);
                  break;
                }
              }
            }}
            onHide={() => toggleVisibility(ws.id)}
          >
            <Component />
          </WidgetWrapper>
        );
      })}
    </div>
  );
}
