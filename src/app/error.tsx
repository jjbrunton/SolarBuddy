'use client';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Exception"
        title="Something went wrong"
        description="SolarBuddy hit an unexpected route-level error while rendering this page."
      />
      <Card className="mx-auto max-w-xl text-center">
        <p className="text-sm leading-6 text-sb-text-muted">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={reset}>Try again</Button>
        </div>
      </Card>
    </div>
  );
}
