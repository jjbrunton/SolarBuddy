'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings2, RotateCcw, Plus, X } from 'lucide-react';
import { WidgetWrapper } from './WidgetWrapper';
import type { WidgetDefinition } from './widget-registry';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

interface WidgetState {
  id: string;
  visible: boolean;
}

const STORAGE_KEY = 'sb-dashboard-layout';

function defaultLayoutFor(widgets: WidgetDefinition[]): WidgetState[] {
  return widgets.map((w) => ({ id: w.id, visible: w.defaultVisible !== false }));
}

function loadLayout(widgets: WidgetDefinition[]): WidgetState[] {
  const allIds = widgets.map((w) => w.id);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: WidgetState[] = JSON.parse(stored);
      // Merge: keep stored order/visibility, add new widgets at their
      // registry-defined default visibility so installs that added hidden
      // widgets after an upgrade don't suddenly light up.
      const storedIds = new Set(parsed.map((w) => w.id));
      const result = parsed.filter((w) => allIds.includes(w.id));
      for (const widget of widgets) {
        if (!storedIds.has(widget.id)) {
          result.push({ id: widget.id, visible: widget.defaultVisible !== false });
        }
      }
      return result;
    }
  } catch { /* ignore */ }
  return defaultLayoutFor(widgets);
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
    setLayout(loadLayout(widgets));
  }, [widgets]);

  const updateLayout = useCallback((next: WidgetState[]) => {
    setLayout(next);
    saveLayout(next);
  }, []);

  const toggleVisibility = useCallback(
    (id: string) => {
      updateLayout(layout.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
    },
    [layout, updateLayout],
  );

  const resetLayout = useCallback(() => {
    updateLayout(defaultLayoutFor(widgets));
  }, [widgets, updateLayout]);

  const widgetMap = new Map(widgets.map((w) => [w.id, w]));
  const visibleWidgets = layout.filter((w) => w.visible);
  const hiddenWidgets = layout.filter((w) => !w.visible);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="System dashboard"
        description="The five most useful signals are pinned by default. Add more widgets or reorder the view via the edit button."
        actions={(
          <Button variant={editing ? 'warning' : 'secondary'} size="sm" onClick={() => setEditing(!editing)}>
            {editing ? <X size={14} /> : <Settings2 size={14} />}
            {editing ? 'Done' : 'Edit dashboard'}
          </Button>
        )}
      />

      {/* Edit mode: reset + add hidden widgets */}
      {editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-[0.75rem] border border-sb-rule bg-sb-card/70 p-3 sm:p-4">
          <Button onClick={resetLayout} variant="secondary" size="sm">
            <RotateCcw size={12} />
            Reset layout
          </Button>
          {hiddenWidgets.map((hw) => {
            const def = widgetMap.get(hw.id);
            if (!def) return null;
            return (
              <Button
                key={hw.id}
                onClick={() => toggleVisibility(hw.id)}
                variant="ghost"
                size="sm"
                className="border border-dashed border-sb-rule"
              >
                <Plus size={12} />
                {def.label}
              </Button>
            );
          })}
        </div>
      )}

      {/* Render visible widgets in a 2-col grid on desktop. Full-size widgets
          span both columns; half-size widgets flow as 1 column. Mobile is a
          simple stack. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {visibleWidgets.map((ws, index) => {
          const def = widgetMap.get(ws.id);
          if (!def) return null;
          const Component = def.component;
          const spanClass = def.size === 'half' ? '' : 'md:col-span-2';
          return (
            <div key={ws.id} className={spanClass}>
              <WidgetWrapper
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
