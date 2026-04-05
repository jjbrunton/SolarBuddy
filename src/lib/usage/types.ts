export type DayType = 'weekday' | 'weekend';

export interface UsageBucket {
  day_type: DayType;
  slot_index: number; // 0..47
  median_w: number;
  p25_w: number;
  p75_w: number;
  mean_w: number;
  sample_count: number;
  updated_at: string;
}

export interface UsageHighPeriod {
  start_slot: number;
  end_slot: number;
  median_w: number;
  start_local: string; // "HH:MM"
  end_local: string; // "HH:MM"
}

export interface UsageHighPeriods {
  weekday: UsageHighPeriod[];
  weekend: UsageHighPeriod[];
}

export interface UsageProfileMeta {
  baseload_w: number;
  baseload_percentile: number;
  window_days: number;
  window_start: string;
  window_end: string;
  total_samples: number;
  computed_at: string;
  high_periods: UsageHighPeriods;
}

export interface UsageProfile {
  buckets: UsageBucket[]; // up to 96 entries (48 weekday + 48 weekend)
  meta: UsageProfileMeta | null;
}

export interface UsageProfileResult {
  ok: boolean;
  reason?: string;
  profile?: UsageProfile;
  stats: {
    total_samples: number;
    weekday_samples: number;
    weekend_samples: number;
    dropped_days: number;
  };
}
