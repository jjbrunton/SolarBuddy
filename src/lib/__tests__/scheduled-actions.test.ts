import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as scheduledActionsModule from '../scheduled-actions';

const { prepareMock, allMock, runMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  runMock: vi.fn(),
}));

vi.mock('../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

describe('scheduled actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareMock.mockReturnValue({
      all: allMock,
      run: runMock,
    });
  });

  it('maps stored rows into scheduled actions', () => {
    allMock.mockReturnValue([
      {
        id: 1,
        name: 'Wake up',
        action: 'charge',
        time: '01:30',
        days: 'daily',
        soc_condition: 'below',
        soc_threshold: 40,
        duration_minutes: 60,
        enabled: 1,
        created_at: '2026-04-03T00:00:00Z',
      },
    ]);

    expect(scheduledActionsModule.getScheduledActions()).toEqual([
      {
        id: 1,
        name: 'Wake up',
        action: 'charge',
        time: '01:30',
        days: 'daily',
        soc_condition: 'below',
        soc_threshold: 40,
        duration_minutes: 60,
        enabled: true,
        created_at: '2026-04-03T00:00:00Z',
      },
    ]);
    expect(prepareMock).toHaveBeenCalledWith('SELECT * FROM scheduled_actions ORDER BY time ASC');
  });

  it('loads only enabled actions when requested', () => {
    allMock.mockReturnValue([]);

    scheduledActionsModule.getEnabledScheduledActions();

    expect(prepareMock).toHaveBeenCalledWith(
      'SELECT * FROM scheduled_actions WHERE enabled = 1 ORDER BY time ASC',
    );
  });

  it('updates an existing action when an id is provided', () => {
    const result = scheduledActionsModule.upsertScheduledAction({
      id: 9,
      name: 'Maintain',
      action: 'hold',
      time: '10:00',
      days: 'weekdays',
      soc_condition: 'any',
      soc_threshold: 0,
      duration_minutes: 30,
      enabled: false,
    });

    expect(runMock).toHaveBeenCalledWith(
      'Maintain',
      'hold',
      '10:00',
      'weekdays',
      'any',
      0,
      30,
      0,
      9,
    );
    expect(result).toEqual({
      id: 9,
      name: 'Maintain',
      action: 'hold',
      time: '10:00',
      days: 'weekdays',
      soc_condition: 'any',
      soc_threshold: 0,
      duration_minutes: 30,
      enabled: false,
      created_at: '',
    });
  });

  it('inserts a new action and returns the generated id', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
    runMock.mockReturnValue({ lastInsertRowid: 14 });

    const result = scheduledActionsModule.upsertScheduledAction({
      name: 'Charge later',
      action: 'charge',
      time: '23:30',
      days: 'weekends',
      soc_condition: 'below',
      soc_threshold: 50,
      duration_minutes: 90,
      enabled: true,
    });

    expect(runMock).toHaveBeenCalledWith(
      'Charge later',
      'charge',
      '23:30',
      'weekends',
      'below',
      50,
      90,
      1,
    );
    expect(result).toEqual({
      id: 14,
      name: 'Charge later',
      action: 'charge',
      time: '23:30',
      days: 'weekends',
      soc_condition: 'below',
      soc_threshold: 50,
      duration_minutes: 90,
      enabled: true,
      created_at: '2026-04-03T12:00:00.000Z',
    });
    vi.useRealTimers();
  });

  it('deletes an action by id', () => {
    scheduledActionsModule.deleteScheduledAction(5);

    expect(prepareMock).toHaveBeenCalledWith('DELETE FROM scheduled_actions WHERE id = ?');
    expect(runMock).toHaveBeenCalledWith(5);
  });

  it('returns null when no enabled actions match the current slot', () => {
    allMock.mockReturnValue([]);

    expect(scheduledActionsModule.evaluateScheduledActions(new Date('2026-04-03T10:00:00Z'), 50)).toBeNull();
  });

  it('matches weekday actions and honours an above-SOC threshold', () => {
    allMock.mockReturnValue([
      {
        id: 1,
        name: 'Discharge peak',
        action: 'discharge',
        time: '10:00',
        days: 'weekdays',
        soc_condition: 'above',
        soc_threshold: 60,
        duration_minutes: 30,
        enabled: true,
        created_at: '2026-04-03T00:00:00Z',
      },
    ]);

    expect(scheduledActionsModule.evaluateScheduledActions(new Date('2026-04-03T09:15:00Z'), 75)).toEqual({
      action: 'discharge',
      reason: 'Scheduled action "Discharge peak": discharge (SOC above 60%)',
    });
  });

  it('matches custom day lists and treats null SOC as unconditional', () => {
    allMock.mockReturnValue([
      {
        id: 1,
        name: 'Hold Sunday',
        action: 'hold',
        time: '08:00',
        days: 'sun, wed',
        soc_condition: 'below',
        soc_threshold: 30,
        duration_minutes: 120,
        enabled: true,
        created_at: '2026-04-03T00:00:00Z',
      },
    ]);

    expect(scheduledActionsModule.evaluateScheduledActions(new Date('2026-04-05T08:30:00Z'), null)).toEqual({
      action: 'hold',
      reason: 'Scheduled action "Hold Sunday": hold (SOC below 30%)',
    });
  });

  it('skips actions that are outside the window or fail weekend/below conditions', () => {
    allMock.mockReturnValue([
      {
        id: 1,
        name: 'Weekend top-up',
        action: 'charge',
        time: '07:00',
        days: 'weekends',
        soc_condition: 'below',
        soc_threshold: 40,
        duration_minutes: 30,
        enabled: true,
        created_at: '2026-04-03T00:00:00Z',
      },
    ]);

    expect(scheduledActionsModule.evaluateScheduledActions(new Date('2026-04-06T07:10:00Z'), 45)).toBeNull();
  });
});
