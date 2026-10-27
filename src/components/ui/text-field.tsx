import type { InputHTMLAttributes } from "react";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
};

export function TextField({ label, name, id, className = "", ...props }: TextFieldProps) {
  const inputId = id ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        className={`min-h-12 rounded-lg border border-glaze bg-paper px-4 text-lg text-ink placeholder:text-muted focus:border-leaf focus:outline-none focus-visible:outline-3 focus-visible:outline-leaf ${className}`}
        {...props}
      />
    </div>
  );
}
