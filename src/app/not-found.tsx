import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-bold text-sb-text">Page Not Found</h2>
      <p className="text-sm text-sb-text-muted">The page you requested does not exist.</p>
      <Link
        href="/"
        className="rounded-md bg-sb-accent px-4 py-2 text-sm font-medium text-white hover:bg-sb-accent-hover"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
