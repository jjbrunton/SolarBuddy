export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-7 w-36 animate-pulse rounded bg-sb-card" />
        <div className="h-9 w-44 animate-pulse rounded-lg bg-sb-card" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-sb-card" />
        ))}
      </div>
      <div className="h-[350px] animate-pulse rounded-lg bg-sb-card" />
    </div>
  );
}
