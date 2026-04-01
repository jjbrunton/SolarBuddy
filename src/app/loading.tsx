export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="rounded-[1.25rem] border border-sb-border bg-sb-card p-6 shadow-[var(--shadow-sb-sm)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sb-border border-t-sb-accent" />
      </div>
    </div>
  );
}
