import type { AppSettings } from '../config';

export type TariffType = 'agile' | 'go' | 'flux' | 'cosy';

export interface TariffBand {
  name: string;
  start: string; // HH:MM local time
  end: string;   // HH:MM local time
  rateKey: keyof AppSettings;
}

export interface TariffDefinition {
  type: TariffType;
  label: string;
  bands: TariffBand[];
  usesApiRates: boolean;
}

export const TARIFF_DEFINITIONS: Record<TariffType, TariffDefinition> = {
  agile: {
    type: 'agile',
    label: 'Agile',
    bands: [],
    usesApiRates: true,
  },
  go: {
    type: 'go',
    label: 'Go / Intelligent Go',
    bands: [
      { name: 'off_peak', start: '00:30', end: '05:30', rateKey: 'tariff_offpeak_rate' },
      { name: 'standard', start: '05:30', end: '00:30', rateKey: 'tariff_standard_rate' },
    ],
    usesApiRates: false,
  },
  flux: {
    type: 'flux',
    label: 'Flux',
    bands: [
      { name: 'off_peak', start: '02:00', end: '05:00', rateKey: 'tariff_offpeak_rate' },
      { name: 'peak', start: '16:00', end: '19:00', rateKey: 'tariff_peak_rate' },
      { name: 'standard', start: '00:00', end: '00:00', rateKey: 'tariff_standard_rate' }, // catch-all
    ],
    usesApiRates: false,
  },
  cosy: {
    type: 'cosy',
    label: 'Cosy',
    bands: [
      { name: 'cheap_1', start: '04:00', end: '07:00', rateKey: 'tariff_offpeak_rate' },
      { name: 'cheap_2', start: '13:00', end: '16:00', rateKey: 'tariff_offpeak_rate' },
      { name: 'standard', start: '00:00', end: '00:00', rateKey: 'tariff_standard_rate' }, // catch-all
    ],
    usesApiRates: false,
  },
};

export function getTariffDefinition(type: string): TariffDefinition {
  return TARIFF_DEFINITIONS[type as TariffType] ?? TARIFF_DEFINITIONS.agile;
}
