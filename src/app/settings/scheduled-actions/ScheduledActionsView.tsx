'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/settings/shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ScheduledAction {
  id: string;
  name: string;
  action: 'charge' | 'discharge' | 'hold';
  time: string;
  days: string;
  soc_condition: 'above' | 'below' | 'any';
  soc_threshold: number;
  duration_minutes: number;
  enabled: boolean;
}

type ActionDraft = Omit<ScheduledAction, 'id'> & { id?: string };

const EMPTY_DRAFT: ActionDraft = {
  name: '',
  action: 'charge',
  time: '00:00',
  days: 'daily',
  soc_condition: 'any',
  soc_threshold: 50,
  duration_minutes: 30,
  enabled: true,
};

const ACTION_BADGE_KIND: Record<string, 'primary' | 'success' | 'warning'> = {
  charge: 'primary',
  discharge: 'success',
  hold: 'warning',
};

const ACTION_LABELS: Record<string, string> = {
  charge: 'Charge',
  discharge: 'Discharge',
  hold: 'Hold',
};

const DAYS_LABELS: Record<string, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDays(days: string): string {
  return DAYS_LABELS[days] ?? days.toUpperCase();
}

function formatSOC(condition: string, threshold: number): string {
  if (condition === 'any') return 'Unconditional';
  const symbol = condition === 'above' ? '>' : '<';
  return `when SOC ${symbol} ${threshold}%`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ScheduledActionsView() {
  const [actions, setActions] = useState<ScheduledAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ActionDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  /* ---- Fetch ---------------------------------------------------- */

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduled-actions');
      if (!res.ok) throw new Error('Failed to load scheduled actions');
      const json = await res.json();
      setActions(json.actions ?? json ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  /* ---- CRUD ----------------------------------------------------- */

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const isNew = !draft.id;
      const url = '/api/scheduled-actions' + (isNew ? '' : `?id=${draft.id}`);
      const method = isNew ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save');
      }
      setEditing(false);
      setDraft(EMPTY_DRAFT);
      await fetchActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/scheduled-actions?id=${id}`, { method: 'DELETE' });
      await fetchActions();
    } catch {
      setError('Failed to delete action');
    }
  };

  const handleToggle = async (action: ScheduledAction) => {
    try {
      await fetch(`/api/scheduled-actions?id=${action.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !action.enabled }),
      });
      await fetchActions();
    } catch {
      setError('Failed to toggle action');
    }
  };

  const openNew = () => {
    setDraft(EMPTY_DRAFT);
    setEditing(true);
  };

  const openEdit = (action: ScheduledAction) => {
    setDraft({ ...action });
    setEditing(true);
  };

  const updateDraft = <K extends keyof ActionDraft>(key: K, value: ActionDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  /* ---- Render --------------------------------------------------- */

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-sb-text">Scheduled Actions</h2>
          <p className="text-sm leading-6 text-sb-text-muted">Define time-based rules with SOC conditions to automate charge, discharge, and hold operations.</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus size={14} />
          New Action
        </Button>
      </div>

      {error ? <p className="text-sm text-sb-danger">{error}</p> : null}

      {/* ---- Editor ------------------------------------------------ */}

      {editing ? (
        <Card>
          <div className="mb-5 flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-sb-text">
                {draft.id ? 'Edit Action' : 'New Action'}
              </h2>
              <p className="text-sm leading-6 text-sb-text-muted">
                Configure when and under what conditions this action should run.
              </p>
            </div>
            <button
              onClick={() => setEditing(false)}
              className="rounded-xl p-2 text-sb-text-muted hover:bg-sb-active hover:text-sb-text"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name" description="A short label for this rule.">
              <input
                className={inputClass}
                type="text"
                placeholder="e.g. Overnight Charge"
                value={draft.name}
                onChange={(e) => updateDraft('name', e.target.value)}
              />
            </Field>

            <Field label="Action" description="Inverter mode to apply.">
              <select
                className={inputClass}
                value={draft.action}
                onChange={(e) => updateDraft('action', e.target.value as ActionDraft['action'])}
              >
                <option value="charge">Charge</option>
                <option value="discharge">Discharge</option>
                <option value="hold">Hold</option>
              </select>
            </Field>

            <Field label="Start Time" description="Local time to begin the action.">
              <input
                className={inputClass}
                type="time"
                value={draft.time}
                onChange={(e) => updateDraft('time', e.target.value)}
              />
            </Field>

            <Field label="Duration (minutes)" description="How long the action lasts.">
              <input
                className={inputClass}
                type="number"
                min="5"
                max="1440"
                value={draft.duration_minutes}
                onChange={(e) => updateDraft('duration_minutes', Number(e.target.value))}
              />
            </Field>

            <Field label="Days" description="Which days this rule is active.">
              <select
                className={inputClass}
                value={draft.days}
                onChange={(e) => updateDraft('days', e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekends">Weekends</option>
                <option value="mon">Monday</option>
                <option value="tue">Tuesday</option>
                <option value="wed">Wednesday</option>
                <option value="thu">Thursday</option>
                <option value="fri">Friday</option>
                <option value="sat">Saturday</option>
                <option value="sun">Sunday</option>
              </select>
            </Field>

            <Field label="SOC Condition" description="Optional state-of-charge gate.">
              <select
                className={inputClass}
                value={draft.soc_condition}
                onChange={(e) => updateDraft('soc_condition', e.target.value as ActionDraft['soc_condition'])}
              >
                <option value="any">Any (unconditional)</option>
                <option value="above">Above threshold</option>
                <option value="below">Below threshold</option>
              </select>
            </Field>

            {draft.soc_condition !== 'any' ? (
              <Field label="SOC Threshold (%)" description="Battery level boundary for the condition.">
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  max="100"
                  value={draft.soc_threshold}
                  onChange={(e) => updateDraft('soc_threshold', Number(e.target.value))}
                />
              </Field>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !draft.name.trim()}>
              {saving ? 'Saving...' : draft.id ? 'Update Action' : 'Create Action'}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ---- List -------------------------------------------------- */}

      {loading ? (
        <Card>
          <p className="text-sb-text-muted">Loading scheduled actions...</p>
        </Card>
      ) : actions.length === 0 && !editing ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-sm text-sb-text-muted">
              No scheduled actions yet. Click <strong>New Action</strong> to create your first automation rule.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {actions.map((action) => (
            <Card key={action.id} className={`transition-opacity ${action.enabled ? '' : 'opacity-60'}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Left: info */}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-sb-text">{action.name}</span>
                    <Badge kind={ACTION_BADGE_KIND[action.action]}>
                      {ACTION_LABELS[action.action]}
                    </Badge>
                    {!action.enabled ? <Badge kind="default">Disabled</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-sb-text-muted">
                    <span>{action.time} for {action.duration_minutes} min</span>
                    <span>{formatDays(action.days)}</span>
                    <span>{formatSOC(action.soc_condition, action.soc_threshold)}</span>
                  </div>
                </div>

                {/* Right: controls */}
                <div className="flex shrink-0 items-center gap-2">
                  {/* Toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggle(action)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                      action.enabled ? 'bg-sb-accent' : 'bg-sb-border'
                    }`}
                    role="switch"
                    aria-checked={action.enabled}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                        action.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>

                  <Button variant="ghost" size="sm" onClick={() => openEdit(action)}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(action.id)}>
                    <Trash2 size={14} className="text-sb-danger" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
