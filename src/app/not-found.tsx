import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';

export default function NotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Navigation"
        title="Page not found"
        description="The route you requested doesn’t map to a current SolarBuddy page."
      />
      <Card className="mx-auto max-w-xl text-center">
        <p className="text-sm leading-6 text-sb-text-muted">
          The page may have moved, or the URL may be incorrect.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-xl border border-transparent bg-sb-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sb-accent-hover"
        >
          Go to dashboard
        </Link>
      </Card>
    </div>
  );
}
