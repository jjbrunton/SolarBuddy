interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div className={`rounded-lg border border-sb-border bg-sb-card p-5 ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-semibold text-sb-text">{title}</h2>
      {children}
    </div>
  );
}
