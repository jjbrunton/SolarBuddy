'use client';

import { Card } from '@/components/ui/Card';
import { useSettings, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

export default function ChargingSettingsView() {
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  const isNightFill = settings.charging_strategy !== 'opportunistic_topup';

  return (
    <div className="space-y-6">
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
        <SettingsSection
          title="Negative Prices"
        >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <Field
            label="Discharge During Long Negative Runs"
            description="When a negative-price run is long enough to fully recharge, discharge first to free capacity, then charge in the remaining negative slots."
          >
            <select
              className={inputClass}
              value={settings.negative_run_discharge}
              onChange={(e) => update('negative_run_discharge', e.target.value)}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </Field>
        </div>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="Automatic Discharge"
          description="Pick the highest-priced future slots and force a discharge window while keeping a reserve SOC. This uses the current tariff horizon and the inverter's forced discharge mode."
        >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Smart Discharge"
            description="Enable automatic discharge planning for the most expensive future slots."
          >
            <select
              className={inputClass}
              value={settings.smart_discharge}
              onChange={(e) => update('smart_discharge', e.target.value)}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </Field>
          <Field
            label="Discharge Price Threshold (p/kWh)"
            description="Optional floor. If greater than 0, SolarBuddy only discharges in slots at or above this price."
          >
            <input
              className={inputClass}
              type="number"
              step="0.5"
              value={settings.discharge_price_threshold}
              onChange={(e) => update('discharge_price_threshold', e.target.value)}
            />
          </Field>
          <Field
            label="Reserve SOC Floor (%)"
            description="Lowest battery level the discharge planner is allowed to use."
          >
            <input
              className={inputClass}
              type="number"
              min="0"
              max="100"
              value={settings.discharge_soc_floor}
              onChange={(e) => update('discharge_soc_floor', e.target.value)}
            />
          </Field>
        </div>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="Peak Protection"
          description="Pre-charge the battery before expensive peak periods to avoid high-cost grid import."
        >
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
          <Field label="Peak Detection" description="Manual uses fixed times below. Auto finds the most expensive contiguous block in the tariff.">
            <select
              className={inputClass}
              value={settings.peak_detection}
              onChange={(e) => update('peak_detection', e.target.value)}
            >
              <option value="manual">Manual</option>
              <option value="auto">Auto-detect</option>
            </select>
          </Field>
          {settings.peak_detection === 'auto' && (
            <Field label="Peak Duration (slots)" description="Number of half-hour slots for the auto-detected peak window.">
              <input
                className={inputClass}
                type="number"
                min="1"
                max="20"
                value={settings.peak_duration_slots}
                onChange={(e) => update('peak_duration_slots', e.target.value)}
              />
            </Field>
          )}
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
          {settings.peak_detection !== 'auto' && (
            <>
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
            </>
          )}
        </div>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="Advanced Scheduling"
          description="Extra heuristics for squeezing more value out of Agile tariff pricing. All disabled by default."
        >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Always Charge Below (p/kWh)"
            description="Unconditionally charge whenever the slot price is below this threshold. Set to 0 to disable."
          >
            <input
              className={inputClass}
              type="number"
              step="0.5"
              min="0"
              value={settings.always_charge_below_price}
              onChange={(e) => update('always_charge_below_price', e.target.value)}
            />
          </Field>
          <Field
            label="Pre-Cheapest Suppression"
            description="Hold the battery in the run-up to the cheapest charge block so it doesn't discharge before cheap slots begin."
          >
            <select
              className={inputClass}
              value={settings.pre_cheapest_suppression}
              onChange={(e) => update('pre_cheapest_suppression', e.target.value)}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </Field>
          <Field
            label="Solar Skip Overnight Charge"
            description="Skip the overnight charge when tomorrow's PV forecast exceeds the threshold. Requires PV forecast to be enabled. Night Fill only."
          >
            <select
              className={inputClass}
              value={settings.solar_skip_enabled}
              onChange={(e) => update('solar_skip_enabled', e.target.value)}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </Field>
          {settings.solar_skip_enabled === 'true' && (
            <Field
              label="Solar Skip Threshold (kWh)"
              description="Minimum forecasted PV generation for the next day to skip the overnight charge."
            >
              <input
                className={inputClass}
                type="number"
                step="1"
                min="1"
                value={settings.solar_skip_threshold_kwh}
                onChange={(e) => update('solar_skip_threshold_kwh', e.target.value)}
              />
            </Field>
          )}
        </div>
        </SettingsSection>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
