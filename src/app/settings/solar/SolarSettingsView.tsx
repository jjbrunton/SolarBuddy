'use client';

import { useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useSettings, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

type GeoStatus = 'idle' | 'locating' | 'error';

export default function SolarSettingsView() {
  const { settings, update, save, saving, message } = useSettings();
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching'>('idle');
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      setGeoStatus('error');
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoStatus('locating');
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        update('pv_latitude', pos.coords.latitude.toFixed(4));
        update('pv_longitude', pos.coords.longitude.toFixed(4));
        setGeoStatus('idle');
      },
      (err) => {
        setGeoStatus('error');
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : 'Unable to determine your location.',
        );
      },
      { timeout: 10000 },
    );
  };

  const handleFetchForecast = async () => {
    setFetchStatus('fetching');
    setFetchMessage(null);
    try {
      const res = await fetch('/api/forecast?force=true', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFetchMessage(json.error || 'Failed to fetch forecast');
      } else {
        setFetchMessage(`Fetched ${json.count} forecast slots`);
      }
    } catch {
      setFetchMessage('Failed to fetch forecast');
    }
    setFetchStatus('idle');
  };

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  const forecastEnabled = settings.pv_forecast_enabled === 'true';

  return (
    <div className="space-y-6">
      <Card>
        <SettingsSection
          title="PV Forecast"
          description="forecast.solar provides free rooftop PV forecasts based on your system location and capacity. Enter your panel details below."
        >
          <div className="space-y-4">
            <Field label="Enable PV Forecast" description="When enabled, the scheduler will factor predicted solar generation into charge planning.">
              <select
                className={inputClass}
                value={settings.pv_forecast_enabled}
                onChange={(e) => update('pv_forecast_enabled', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>

            {forecastEnabled ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleGeolocate}
                    disabled={geoStatus === 'locating'}
                  >
                    <MapPin size={16} />
                    {geoStatus === 'locating' ? 'Locating…' : 'Use my location'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleFetchForecast}
                    disabled={fetchStatus === 'fetching'}
                  >
                    <RefreshCw size={16} className={fetchStatus === 'fetching' ? 'animate-spin' : ''} />
                    {fetchStatus === 'fetching' ? 'Fetching…' : 'Refresh forecast'}
                  </Button>
                  {geoStatus === 'error' && geoError ? (
                    <span className="text-xs text-sb-danger">{geoError}</span>
                  ) : null}
                  {fetchMessage ? (
                    <span className="text-xs text-sb-text-muted">{fetchMessage}</span>
                  ) : null}
                </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Latitude" description="Decimal degrees, e.g. 51.5074">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_latitude}
                    onChange={(e) => update('pv_latitude', e.target.value)}
                    placeholder="51.5074"
                  />
                </Field>
                <Field label="Longitude" description="Decimal degrees, e.g. -0.1278">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_longitude}
                    onChange={(e) => update('pv_longitude', e.target.value)}
                    placeholder="-0.1278"
                  />
                </Field>
                <Field label="Panel capacity (kWp)" description="Total installed PV capacity in kilowatts peak">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_kwp}
                    onChange={(e) => update('pv_kwp', e.target.value)}
                    placeholder="4.0"
                  />
                </Field>
                <Field label="Declination (tilt)" description="Panel angle from horizontal in degrees (0–90). Default 35.">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_declination}
                    onChange={(e) => update('pv_declination', e.target.value)}
                    placeholder="35"
                  />
                </Field>
                <Field label="Azimuth" description="Panel direction: -180 to 180 (0 = south, -90 = east, 90 = west).">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_azimuth}
                    onChange={(e) => update('pv_azimuth', e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Forecast confidence" description="Estimate is the median. Conservative assumes 80% of estimate. Optimistic assumes 120%.">
                  <select
                    className={inputClass}
                    value={settings.pv_forecast_confidence}
                    onChange={(e) => update('pv_forecast_confidence', e.target.value)}
                  >
                    <option value="estimate">Estimate (median)</option>
                    <option value="estimate10">Conservative (80%)</option>
                    <option value="estimate90">Optimistic (120%)</option>
                  </select>
                </Field>
              </div>
              </div>
            ) : null}
          </div>
        </SettingsSection>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
