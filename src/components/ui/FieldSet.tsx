interface FieldSetProps {
  legend: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldSet({ legend, children, className = '' }: FieldSetProps) {
  return (
    <fieldset className={`rounded-[1.25rem] border border-sb-border bg-sb-surface-muted/60 p-5 ${className}`}>
      <legend className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}
