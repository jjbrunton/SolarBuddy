'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';
import { SegmentedTabs } from '@/components/ui/Tabs';
import { formatCost } from '@/lib/forecast';

const SavingsChart = dynamic(
  () => import('@/components/analytics/SavingsChart').then((m) => ({ default: m.SavingsChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const AccountingChart = dynamic(
  () => import('@/components/analytics/AccountingChart').then((m) => ({ default: m.AccountingChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const PERIODS = [
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

const TABS = [
  { label: 'Cost Savings', value: 'savings' },
  { label: 'Cost & Profit', value: 'accounting' },
  { label: 'Battery Profit', value: 'profit' },
];

interface SavingsDayData {
  date: string;
  import_kwh: number;
  actual_cost: number;
  flat_rate_cost: number;
  peak_rate_cost: number;
  savings: number;
}

interface SavingsSummary {
  total_import_kwh: number;
  actual_cost: number;
  flat_rate_cost: number;
  peak_rate_cost: number;
  savings_vs_flat: number;
  savings_vs_peak: number;
}

interface AccountingDayData {
  date: string;
  import_kwh: number;
  import_cost: number;
  export_kwh: number;
  export_revenue: number;
  net_cost: number;
}

interface AccountingSummary {
  total_import_kwh: number;
  total_import_cost: number;
  total_export_kwh: number;
  total_export_revenue: number;
  total_net_cost: number;
}

interface BatteryProfitDayData {
  date: string;
  charge_cost: number;
  discharge_revenue: number;
  net_profit: number;
  expected_charge_cost: number;
  expected_discharge_revenue: number;
  slot_count: number;
}

interface BatteryProfitSummary {
  total_charge_cost: number;
  total_discharge_revenue: number;
  total_net_profit: number;
  total_expected_charge_cost: number;
  total_expected_discharge_revenue: number;
  variance: number;
  completed_slot_count: number;
}

function formatPence(p: number) {
  if (Math.abs(p) >= 100) return `£${(p / 100).toFixed(2)}`;
  return `${p.toFixed(1)}p`;
}

export default function SavingsPageView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '7d';
  const [tab, setTab] = useState('savings');

  const [savingsSummary, setSavingsSummary] = useState<SavingsSummary | null>(null);
  const [savingsDaily, setSavingsDaily] = useState<SavingsDayData[]>([]);
  const [savingsLoading, setSavingsLoading] = useState(true);

  const [accountingSummary, setAccountingSummary] = useState<AccountingSummary | null>(null);
  const [accountingDaily, setAccountingDaily] = useState<AccountingDayData[]>([]);
  const [accountingLoading, setAccountingLoading] = useState(true);

  const [profitSummary, setProfitSummary] = useState<BatteryProfitSummary | null>(null);
  const [profitDaily, setProfitDaily] = useState<BatteryProfitDayData[]>([]);
  const [profitLoading, setProfitLoading] = useState(true);

  useEffect(() => {
    setSavingsLoading(true);
    fetch(`/api/analytics/savings?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        setSavingsSummary(json.summary);
        setSavingsDaily(json.daily || []);
      })
      .catch(() => {})
      .finally(() => setSavingsLoading(false));

    setAccountingLoading(true);
    fetch(`/api/analytics/accounting?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        setAccountingSummary(json.summary);
        setAccountingDaily(json.daily || []);
      })
      .catch(() => {})
      .finally(() => setAccountingLoading(false));

    setProfitLoading(true);
    fetch(`/api/analytics/battery-profit?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        setProfitSummary(json.summary);
        setProfitDaily(json.daily || []);
      })
      .catch(() => {})
      .finally(() => setProfitLoading(false));
  }, [period]);

  const netColor =
    accountingSummary && accountingSummary.total_net_cost < 0
      ? 'text-sb-success'
      : accountingSummary && accountingSummary.total_net_cost > 0
        ? 'text-sb-danger'
        : 'text-sb-text';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Savings"
        description="Track how your battery scheduling strategy performs financially."
        actions={<PeriodSelector periods={PERIODS} selected={period} />}
      />

      <SegmentedTabs items={TABS} activeValue={tab} onChange={setTab} />

      {tab === 'savings' && (
        <>
          {savingsSummary && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Total Savings vs Flat"
                value={formatPence(savingsSummary.savings_vs_flat)}
                valueColor={savingsSummary.savings_vs_flat >= 0 ? 'text-sb-success' : 'text-sb-danger'}
                subtext={`vs ${formatPence(savingsSummary.savings_vs_peak)} vs peak`}
              />
              <StatCard
                label="Actual Cost"
                value={formatPence(savingsSummary.actual_cost)}
                valueColor="text-sb-warning"
              />
              <StatCard
                label="Flat Rate Would Be"
                value={formatPence(savingsSummary.flat_rate_cost)}
                subtext="at 24.5p/kWh"
              />
              <StatCard
                label="Total Import"
                value={`${savingsSummary.total_import_kwh} kWh`}
              />
            </div>
          )}

          <Card>
            <CardHeader title="Daily cost comparison" subtitle="Actual import cost versus a flat-rate baseline over the selected period." />
            {savingsLoading && savingsDaily.length === 0 ? (
              <p className="py-12 text-center text-sb-text-muted">Loading savings data...</p>
            ) : savingsDaily.length === 0 ? (
              <EmptyState
                title="No savings data yet"
                description="SolarBuddy needs both stored readings and tariff data before it can calculate a meaningful savings comparison."
              />
            ) : (
              <SavingsChart data={savingsDaily} />
            )}
          </Card>

          {savingsDaily.length > 0 && (
            <Card>
              <CardHeader title="Daily breakdown" subtitle="Day-by-day import volume and cost comparison." />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sb-border text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                      <th className="px-3 py-3">Date</th>
                      <th className="px-3 py-3">Import</th>
                      <th className="px-3 py-3">Actual Cost</th>
                      <th className="px-3 py-3">Flat Rate</th>
                      <th className="px-3 py-3">Savings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savingsDaily.map((d) => (
                      <tr key={d.date} className="border-b border-sb-border/50">
                        <td className="px-3 py-3 text-sb-text">{d.date}</td>
                        <td className="px-3 py-3 text-sb-text">{d.import_kwh} kWh</td>
                        <td className="px-3 py-3 text-sb-warning">{formatPence(d.actual_cost)}</td>
                        <td className="px-3 py-3 text-sb-text-muted">{formatPence(d.flat_rate_cost)}</td>
                        <td className={`px-3 py-3 font-medium ${d.savings >= 0 ? 'text-sb-success' : 'text-sb-danger'}`}>
                          {formatPence(d.savings)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'accounting' && (
        <>
          {accountingSummary && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard
                label="Total Import Cost"
                value={formatCost(accountingSummary.total_import_cost)}
                valueColor="text-sb-danger"
              />
              <StatCard
                label="Total Export Revenue"
                value={formatCost(accountingSummary.total_export_revenue)}
                valueColor="text-sb-success"
              />
              <StatCard
                label="Net Cost"
                value={formatCost(Math.abs(accountingSummary.total_net_cost))}
                subtext={accountingSummary.total_net_cost < 0 ? 'Profit' : accountingSummary.total_net_cost > 0 ? 'Cost' : 'Break even'}
                valueColor={netColor}
              />
              <StatCard
                label="Total Import"
                value={`${accountingSummary.total_import_kwh} kWh`}
                valueColor="text-sb-danger"
              />
              <StatCard
                label="Total Export"
                value={`${accountingSummary.total_export_kwh} kWh`}
                valueColor="text-sb-success"
              />
            </div>
          )}

          <Card>
            <CardHeader title="Daily cost breakdown" subtitle="Import costs, export revenue, and running net cost per day." />
            {accountingLoading && accountingDaily.length === 0 ? (
              <p className="py-12 text-center text-sb-text-muted">Loading accounting data...</p>
            ) : accountingDaily.length === 0 ? (
              <EmptyState
                title="No accounting data yet"
                description="Cost and revenue data will appear once energy import and export readings have been recorded."
              />
            ) : (
              <AccountingChart data={accountingDaily} />
            )}
          </Card>
        </>
      )}

      {tab === 'profit' && (
        <>
          {profitSummary && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Charge Cost"
                value={formatPence(Math.abs(profitSummary.total_charge_cost))}
                valueColor="text-sb-danger"
                subtext={`Expected: ${formatPence(Math.abs(profitSummary.total_expected_charge_cost))}`}
              />
              <StatCard
                label="Discharge Revenue"
                value={formatPence(profitSummary.total_discharge_revenue)}
                valueColor="text-sb-success"
                subtext={`Expected: ${formatPence(profitSummary.total_expected_discharge_revenue)}`}
              />
              <StatCard
                label="Net Profit"
                value={formatPence(Math.abs(profitSummary.total_net_profit))}
                subtext={profitSummary.total_net_profit >= 0 ? 'Profit' : 'Loss'}
                valueColor={profitSummary.total_net_profit >= 0 ? 'text-sb-success' : 'text-sb-danger'}
              />
              <StatCard
                label="Variance"
                value={formatPence(Math.abs(profitSummary.variance))}
                subtext={profitSummary.variance >= 0 ? 'Better than expected' : 'Worse than expected'}
                valueColor={profitSummary.variance >= 0 ? 'text-sb-success' : 'text-sb-warning'}
              />
            </div>
          )}

          <Card>
            <CardHeader title="Daily battery profit" subtitle="Charge costs, discharge revenue, and net profit per day from scheduled battery operations." />
            {profitLoading && profitDaily.length === 0 ? (
              <p className="py-12 text-center text-sb-text-muted">Loading battery profit data...</p>
            ) : profitDaily.length === 0 ? (
              <EmptyState
                title="No battery profit data yet"
                description="Profit tracking begins once scheduled charge and discharge slots complete with telemetry readings available."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sb-border text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                      <th className="px-3 py-3">Date</th>
                      <th className="px-3 py-3">Charge Cost</th>
                      <th className="px-3 py-3">Discharge Rev</th>
                      <th className="px-3 py-3">Net Profit</th>
                      <th className="px-3 py-3">Slots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitDaily.map((d) => (
                      <tr key={d.date} className="border-b border-sb-border/50">
                        <td className="px-3 py-3 text-sb-text">{d.date}</td>
                        <td className="px-3 py-3 text-sb-danger">{formatPence(Math.abs(d.charge_cost))}</td>
                        <td className="px-3 py-3 text-sb-success">{formatPence(d.discharge_revenue)}</td>
                        <td className={`px-3 py-3 font-medium ${d.net_profit >= 0 ? 'text-sb-success' : 'text-sb-danger'}`}>
                          {formatPence(Math.abs(d.net_profit))}
                          {d.net_profit < 0 ? ' loss' : ''}
                        </td>
                        <td className="px-3 py-3 text-sb-text-muted">{d.slot_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
