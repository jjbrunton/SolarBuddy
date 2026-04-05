export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4 rounded-[0.75rem] border border-sb-rule bg-sb-card p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sb-rule border-t-sb-ember" />
        <span className="sb-eyebrow">Loading</span>
      </div>
    </div>
  );
}
