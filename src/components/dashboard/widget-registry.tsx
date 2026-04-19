import LiveGaugesWidget from '@/components/dashboard/widgets/LiveGaugesWidget';
import CurrentModeWidget from '@/components/dashboard/widgets/CurrentModeWidget';
import EnergyFlowWidget from '@/components/dashboard/widgets/EnergyFlowWidget';
import CurrentRateWidget from '@/components/dashboard/widgets/CurrentRateWidget';
import RateChartWidget from '@/components/dashboard/widgets/RateChartWidget';
import UpcomingChargesWidget from '@/components/dashboard/widgets/UpcomingChargesWidget';
import SolarForecastWidget from '@/components/dashboard/widgets/SolarForecastWidget';
import BillEstimateWidget from '@/components/dashboard/widgets/BillEstimateWidget';
import PlanSummaryWidget from '@/components/dashboard/widgets/PlanSummaryWidget';

export type WidgetSize = 'full' | 'half';

export interface WidgetDefinition {
  id: string;
  label: string;
  component: React.ComponentType;
  /**
   * Grid width on desktop. 'full' spans both columns, 'half' occupies one.
   * On mobile every widget is full width. Defaults to 'full'.
   */
  size?: WidgetSize;
  /**
   * Whether the widget is visible by default for new installs. Users can
   * still pin any hidden widget back via the dashboard edit mode. Defaults
   * to true.
   */
  defaultVisible?: boolean;
}

// The default view is intentionally tight: five widgets surfaced on first
// load, the rest pinnable via edit mode. Current Mode is absorbed into the
// Current Rate card (which already shows the active action badge); Bill
// Estimate and Solar Forecast stay available but hidden by default to keep
// the landing page from becoming an endless scroll.
export const DASHBOARD_WIDGETS: WidgetDefinition[] = [
  { id: 'live-gauges', label: 'Live Gauges', component: LiveGaugesWidget, size: 'full' },
  { id: 'current-rate', label: 'Current Rate', component: CurrentRateWidget, size: 'full' },
  { id: 'plan-summary', label: 'Plan Summary', component: PlanSummaryWidget, size: 'full' },
  { id: 'energy-flow', label: 'Energy Flow', component: EnergyFlowWidget, size: 'half' },
  { id: 'upcoming-charges', label: 'Upcoming Charges', component: UpcomingChargesWidget, size: 'half' },
  { id: 'rate-chart', label: 'Rate Chart', component: RateChartWidget, size: 'full' },
  { id: 'current-mode', label: 'Current Mode', component: CurrentModeWidget, size: 'half', defaultVisible: false },
  { id: 'bill-estimate', label: 'Bill Estimate', component: BillEstimateWidget, size: 'half', defaultVisible: false },
  { id: 'solar-forecast', label: 'Solar Forecast', component: SolarForecastWidget, size: 'full', defaultVisible: false },
];
