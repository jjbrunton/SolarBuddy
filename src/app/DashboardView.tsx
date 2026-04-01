'use client';

import { DashboardGrid, type WidgetDefinition } from '@/components/dashboard/DashboardGrid';
import LiveGaugesWidget from '@/components/dashboard/widgets/LiveGaugesWidget';
import EnergyFlowWidget from '@/components/dashboard/widgets/EnergyFlowWidget';
import SystemHealthWidget from '@/components/dashboard/widgets/SystemHealthWidget';
import QuickStatsWidget from '@/components/dashboard/widgets/QuickStatsWidget';
import CurrentRateWidget from '@/components/dashboard/widgets/CurrentRateWidget';
import RateChartWidget from '@/components/dashboard/widgets/RateChartWidget';
import UpcomingChargesWidget from '@/components/dashboard/widgets/UpcomingChargesWidget';

const WIDGETS: WidgetDefinition[] = [
  { id: 'live-gauges', label: 'Live Gauges', component: LiveGaugesWidget },
  { id: 'energy-flow', label: 'Energy Flow', component: EnergyFlowWidget },
  { id: 'system-health', label: 'System Health', component: SystemHealthWidget },
  { id: 'quick-stats', label: 'Quick Stats', component: QuickStatsWidget },
  { id: 'current-rate', label: 'Current Rate', component: CurrentRateWidget },
  { id: 'rate-chart', label: 'Rate Chart', component: RateChartWidget },
  { id: 'upcoming-charges', label: 'Upcoming Charges', component: UpcomingChargesWidget },
];

export default function DashboardView() {
  return <DashboardGrid widgets={WIDGETS} />;
}
