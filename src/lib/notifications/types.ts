export type NotificationEvent =
  | 'state_change'
  | 'battery_exhausted'
  | 'battery_charged'
  | 'schedule_updated';

export interface NotificationMessage {
  event: NotificationEvent;
  title: string;
  body: string;
  timestamp: string;
}

export interface NotificationChannel {
  name: string;
  isEnabled(settings: Record<string, string>): boolean;
  send(message: NotificationMessage, settings: Record<string, string>): Promise<void>;
}

/** Maps each event type to the settings key that toggles it. */
export const EVENT_SETTING_KEYS: Record<NotificationEvent, string> = {
  state_change: 'notifications_state_change',
  battery_exhausted: 'notifications_battery_exhausted',
  battery_charged: 'notifications_battery_charged',
  schedule_updated: 'notifications_schedule_updated',
};

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  state_change: 'State Change',
  battery_exhausted: 'Battery Exhausted',
  battery_charged: 'Battery Charged',
  schedule_updated: 'Schedule Updated',
};
