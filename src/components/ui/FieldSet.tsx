interface FieldSetProps {
  legend: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldSet({ legend, children, className = '' }: FieldSetProps) {
  return (
    <fieldset className={`rounded-lg border border-sb-border p-5 ${className}`}>
      <legend className="px-2 text-sm font-semibold text-sb-text">{legend}</legend>
      {children}
    </fieldset>
  );
}
