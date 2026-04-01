export type PlanAction = 'charge' | 'discharge' | 'hold' | 'do_nothing';

export const PLAN_ACTIONS: PlanAction[] = ['charge', 'discharge', 'hold', 'do_nothing'];

export const ACTION_COLORS: Record<PlanAction, string> = {
  charge: '#5d9cec',
  discharge: '#27c24c',
  hold: '#ff902b',
  do_nothing: '#666666',
};

export const ACTION_LABELS: Record<PlanAction, string> = {
  charge: 'Charge',
  discharge: 'Discharge',
  hold: 'Hold',
  do_nothing: 'Do Nothing',
};

export const ACTION_BADGE_KIND: Record<PlanAction, 'primary' | 'success' | 'warning' | 'default' | 'danger'> = {
  charge: 'primary',
  discharge: 'success',
  hold: 'warning',
  do_nothing: 'default',
};
