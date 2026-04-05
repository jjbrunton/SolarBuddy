interface FieldSetProps {
  legend: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldSet({ legend, children, className = '' }: FieldSetProps) {
  return (
    <fieldset className={`rounded-[0.75rem] border border-sb-rule bg-sb-surface-muted/60 p-5 ${className}`}>
      <legend className="sb-eyebrow px-2">{legend}</legend>
      {children}
    </fieldset>
  );
}
