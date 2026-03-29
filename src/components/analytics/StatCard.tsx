import { Card } from '@/components/ui/Card';

export function StatCard({
  label,
  value,
  subtext,
  valueColor,
}: {
  label: string;
  value: string;
  subtext?: string;
  valueColor?: string;
}) {
  return (
    <Card>
      <p className="text-xs text-sb-text-muted">{label}</p>
      <p className={`mt-1 text-lg font-bold ${valueColor || 'text-sb-text'}`}>{value}</p>
      {subtext && <p className="mt-0.5 text-xs text-sb-text-muted">{subtext}</p>}
    </Card>
  );
}
