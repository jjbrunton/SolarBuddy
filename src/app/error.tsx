'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-bold text-sb-text">Something went wrong</h2>
      <p className="max-w-md text-sm text-sb-text-muted">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-sb-accent px-4 py-2 text-sm font-medium text-white hover:bg-sb-accent-hover"
      >
        Try again
      </button>
    </div>
  );
}
