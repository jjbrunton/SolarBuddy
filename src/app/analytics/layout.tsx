import { AnalyticsTabs } from '@/components/analytics/AnalyticsTabs';

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <AnalyticsTabs />
      {children}
    </div>
  );
}
