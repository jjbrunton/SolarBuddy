import LiveGaugesWidget from '@/components/dashboard/widgets/LiveGaugesWidget';
import CurrentModeWidget from '@/components/dashboard/widgets/CurrentModeWidget';
import EnergyFlowWidget from '@/components/dashboard/widgets/EnergyFlowWidget';
import CurrentRateWidget from '@/components/dashboard/widgets/CurrentRateWidget';
import RateChartWidget from '@/components/dashboard/widgets/RateChartWidget';
import UpcomingChargesWidget from '@/components/dashboard/widgets/UpcomingChargesWidget';
import SolarForecastWidget from '@/components/dashboard/widgets/SolarForecastWidget';
import BillEstimateWidget from '@/components/dashboard/widgets/BillEstimateWidget';

export interface WidgetDefinition {
  id: string;
  label: string;
  component: React.ComponentType;
}

export const DASHBOARD_WIDGETS: WidgetDefinition[] = [
  { id: 'live-gauges', label: 'Live Gauges', component: LiveGaugesWidget },
  { id: 'current-mode', label: 'Current Mode', component: CurrentModeWidget },
  { id: 'energy-flow', label: 'Energy Flow', component: EnergyFlowWidget },
  { id: 'current-rate', label: 'Current Rate', component: CurrentRateWidget },
  { id: 'rate-chart', label: 'Rate Chart', component: RateChartWidget },
  { id: 'upcoming-charges', label: 'Upcoming Charges', component: UpcomingChargesWidget },
  { id: 'bill-estimate', label: 'Bill Estimate', component: BillEstimateWidget },
  { id: 'solar-forecast', label: 'Solar Forecast', component: SolarForecastWidget },
];
