'use client';

import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

export default function ChargingSettingsView() {
  const pathname = usePathname();
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  const isNightFill = settings.charging_strategy !== 'opportunistic_topup';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Charging planner"
        description="Tune slot selection, price thresholds, and battery assumptions so the scheduler behaves consistently across every tariff cycle."
      />
      <SettingsTabs pathname={pathname} />

      <Card>
        <SettingsSection
          title="Charging preferences"
          description="These controls determine how aggressively SolarBuddy buys energy, how it caps charge time, and what assumptions it uses for forecasted state of charge."
        >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Charging Strategy"
            description="Choose between an overnight target-based plan or a rolling top-up plan across the currently published Agile rates."
          >
            <select
              className={inputClass}
              value={settings.charging_strategy}
              onChange={(e) => update('charging_strategy', e.target.value)}
            >
              <option value="night_fill">Night Fill</option>
              <option value="opportunistic_topup">Opportunistic Top-up</option>
            </select>
          </Field>
          <Field
            label="Max Charge Slots"
            description="Maximum number of half-hour slots the planner may use. SolarBuddy will trim this to the slots needed to reach the target SOC when live battery telemetry is available."
          >
            <input
              className={inputClass}
              type="number"
              min="1"
              max="48"
              value={settings.charge_hours}
              onChange={(e) => update('charge_hours', e.target.value)}
            />
          </Field>
          <Field
            label="Price Threshold (p/kWh)"
            description="Optional ceiling. If greater than 0, only slots at or below this rate are eligible for either strategy."
          >
            <input
              className={inputClass}
              type="number"
              step="0.5"
              value={settings.price_threshold}
              onChange={(e) => update('price_threshold', e.target.value)}
            />
          </Field>
          <Field
            label="Target SOC (%)"
            description={isNightFill ? 'Night Fill aims to reach this target by the end of the overnight window.' : 'Opportunistic Top-up keeps trying to reach this target within the currently published Agile tariff horizon.'}
          >
            <input
              className={inputClass}
              type="number"
              min="10"
              max="100"
              value={settings.min_soc_target}
              onChange={(e) => update('min_soc_target', e.target.value)}
            />
          </Field>
          <Field
            label="Window Start"
            description={isNightFill ? 'Night Fill: earliest local time to consider for charging.' : 'Used only by Night Fill.'}
          >
            <input
              className={inputClass}
              type="time"
              value={settings.charge_window_start}
              onChange={(e) => update('charge_window_start', e.target.value)}
            />
          </Field>
          <Field
            label="Window End"
            description={isNightFill ? 'Night Fill: latest local time to consider for charging.' : 'Used only by Night Fill.'}
          >
            <input
              className={inputClass}
              type="time"
              value={settings.charge_window_end}
              onChange={(e) => update('charge_window_end', e.target.value)}
            />
          </Field>
          <Field label="Charge Rate (%)">
            <input
              className={inputClass}
              type="number"
              min="1"
              max="100"
              value={settings.charge_rate}
              onChange={(e) => update('charge_rate', e.target.value)}
            />
          </Field>
          <Field label="Battery Capacity (kWh)" description="Total usable battery capacity">
            <input
              className={inputClass}
              type="number"
              step="0.01"
              min="0.1"
              value={settings.battery_capacity_kwh}
              onChange={(e) => update('battery_capacity_kwh', e.target.value)}
            />
          </Field>
          <Field label="Max Charge Power (kW)" description="Maximum grid-to-battery charge rate">
            <input
              className={inputClass}
              type="number"
              step="0.1"
              min="0.1"
              value={settings.max_charge_power_kw}
              onChange={(e) => update('max_charge_power_kw', e.target.value)}
            />
          </Field>
          <Field label="Est. Consumption (W)" description="Average household consumption for SOC forecasting">
            <input
              className={inputClass}
              type="number"
              step="50"
              min="0"
              value={settings.estimated_consumption_w}
              onChange={(e) => update('estimated_consumption_w', e.target.value)}
            />
          </Field>
        </div>
        </SettingsSection>
      </Card>

      <Card>
        <h3 className="mb-4 font-medium text-sb-text">Negative Prices</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Charge During Negative Prices"
            description="Always charge the battery when Agile prices go negative, regardless of SOC target or strategy."
          >
            <select
              className={inputClass}
              value={settings.negative_price_charging}
              onChange={(e) => update('negative_price_charging', e.target.value)}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          <Field
            label="Pre-Discharge Before Negative Window"
            description="Discharge battery to grid just before a negative price window to maximise what can be absorbed. Not all inverter setups support forced grid export via Solar Assistant."
          >
            <select
              className={inputClass}
              value={settings.negative_price_pre_discharge}
              onChange={(e) => update('negative_price_pre_discharge', e.target.value)}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 font-medium text-sb-text">Peak Protection</h3>
        <p className="mb-4 text-xs text-sb-text-muted">
          Pre-charge the battery before expensive peak periods to avoid high-cost grid import.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Peak Protection" description="Enable automatic pre-peak charging">
            <select
              className={inputClass}
              value={settings.peak_protection}
              onChange={(e) => update('peak_protection', e.target.value)}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </Field>
          <Field label="Peak SOC Target (%)" description="Target battery level before peak period starts">
            <input
              className={inputClass}
              type="number"
              min="10"
              max="100"
              value={settings.peak_soc_target}
              onChange={(e) => update('peak_soc_target', e.target.value)}
            />
          </Field>
          <Field label="Peak Start" description="Start of the expensive peak period (local time)">
            <input
              className={inputClass}
              type="time"
              value={settings.peak_period_start}
              onChange={(e) => update('peak_period_start', e.target.value)}
            />
          </Field>
          <Field label="Peak End" description="End of the expensive peak period (local time)">
            <input
              className={inputClass}
              type="time"
              value={settings.peak_period_end}
              onChange={(e) => update('peak_period_end', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
