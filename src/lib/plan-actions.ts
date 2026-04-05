export type PlanAction = 'charge' | 'discharge' | 'hold';

export const PLAN_ACTIONS: PlanAction[] = ['charge', 'discharge', 'hold'];

/*
 * Agile Almanac action palette.
 *
 * Charge is the *ember* pole — storing solar / cheap import = warm.
 * Discharge is the cool *signal-green* — sending energy out profitably.
 * Hold is a quiet neutral ink — "the planner is waiting".
 *
 * The upstream chart layers these as thin caps on a quiet base bar so
 * you read action from colour hints, not from a full-bar rainbow.
 */
export const ACTION_COLORS: Record<PlanAction, string> = {
  charge: '#ffb547',
  discharge: '#6bb87a',
  hold: '#8c7a52',
};

export const ACTION_LABELS: Record<PlanAction, string> = {
  charge: 'Charge',
  discharge: 'Discharge',
  hold: 'Hold',
};

export const ACTION_BADGE_KIND: Record<PlanAction, 'primary' | 'success' | 'warning' | 'default' | 'danger'> = {
  charge: 'primary',
  discharge: 'success',
  hold: 'default',
};
