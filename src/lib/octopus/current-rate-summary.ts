import type { AgileRate } from './rates';

export type CurrentRateStatus = 'negative' | 'best' | 'cheap' | 'average' | 'expensive';

export interface CurrentRatePoint {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
}

export interface CurrentRateWindow {
  valid_from: string;
  valid_to: string;
}

export interface CurrentRateSummary {
  current: CurrentRatePoint;
  next: CurrentRatePoint | null;
  minPrice: number;
  maxPrice: number;
  averagePrice: number;
  minWindow: CurrentRateWindow;
  maxWindow: CurrentRateWindow;
  status: CurrentRateStatus;
}

function roundPrice(price: number) {
  return Math.round(price * 100) / 100;
}

export function classifyCurrentRate(price: number, minPrice: number, maxPrice: number): CurrentRateStatus {
  if (price < 0) return 'negative';
  if (price === minPrice) return 'best';
  if (price === maxPrice) return 'expensive';

  const spread = maxPrice - minPrice;
  if (spread <= 0.5) return 'average';

  const cheapThreshold = minPrice + spread * 0.35;
  const expensiveThreshold = maxPrice - spread * 0.35;

  if (price <= cheapThreshold) return 'cheap';
  if (price >= expensiveThreshold) return 'expensive';
  return 'average';
}

export function summarizeCurrentRate(
  rates: Pick<AgileRate, 'valid_from' | 'valid_to' | 'price_inc_vat'>[],
  now = new Date(),
): CurrentRateSummary | null {
  if (rates.length === 0) return null;

  const sortedRates = [...rates].sort(
    (left, right) => new Date(left.valid_from).getTime() - new Date(right.valid_from).getTime(),
  );

  const currentIndex = sortedRates.findIndex((rate) => {
    const start = new Date(rate.valid_from);
    const end = new Date(rate.valid_to);
    return now >= start && now < end;
  });

  if (currentIndex === -1) return null;

  const upcomingRates = sortedRates.slice(currentIndex);
  const prices = upcomingRates.map((rate) => roundPrice(rate.price_inc_vat));
  const minPrice = roundPrice(Math.min(...prices));
  const maxPrice = roundPrice(Math.max(...prices));
  const averagePrice = roundPrice(prices.reduce((sum, price) => sum + price, 0) / prices.length);

  const minRate = upcomingRates[prices.indexOf(minPrice)];
  const maxRate = upcomingRates[prices.indexOf(maxPrice)];

  const current = sortedRates[currentIndex];
  const next = sortedRates[currentIndex + 1] ?? null;
  const currentPrice = roundPrice(current.price_inc_vat);

  return {
    current: {
      ...current,
      price_inc_vat: currentPrice,
    },
    next: next
      ? {
          ...next,
          price_inc_vat: roundPrice(next.price_inc_vat),
        }
      : null,
    minPrice,
    maxPrice,
    averagePrice,
    minWindow: { valid_from: minRate.valid_from, valid_to: minRate.valid_to },
    maxWindow: { valid_from: maxRate.valid_from, valid_to: maxRate.valid_to },
    status: classifyCurrentRate(currentPrice, minPrice, maxPrice),
  };
}
