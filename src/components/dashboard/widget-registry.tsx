import LiveGaugesWidget from '@/components/dashboard/widgets/LiveGaugesWidget';
import EnergyFlowWidget from '@/components/dashboard/widgets/EnergyFlowWidget';
import CurrentRateWidget from '@/components/dashboard/widgets/CurrentRateWidget';
import RateChartWidget from '@/components/dashboard/widgets/RateChartWidget';
import UpcomingChargesWidget from '@/components/dashboard/widgets/UpcomingChargesWidget';

export interface WidgetDefinition {
  id: string;
  label: string;
  component: React.ComponentType;
}

export const DASHBOARD_WIDGETS: WidgetDefinition[] = [
  { id: 'live-gauges', label: 'Live Gauges', component: LiveGaugesWidget },
  { id: 'energy-flow', label: 'Energy Flow', component: EnergyFlowWidget },
  { id: 'current-rate', label: 'Current Rate', component: CurrentRateWidget },
  { id: 'rate-chart', label: 'Rate Chart', component: RateChartWidget },
  { id: 'upcoming-charges', label: 'Upcoming Charges', component: UpcomingChargesWidget },
];
