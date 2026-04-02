'use client';

import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { DASHBOARD_WIDGETS } from '@/components/dashboard/widget-registry';

export default function DashboardView() {
  return <DashboardGrid widgets={DASHBOARD_WIDGETS} />;
}
