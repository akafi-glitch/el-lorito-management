import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "quiet";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-leaf text-white hover:bg-leaf-deep",
  secondary: "border border-glaze bg-paper text-leaf hover:border-leaf",
  quiet: "text-leaf-deep hover:bg-leaf/10",
};

export function buttonClasses(variant: Variant = "primary", extra = ""): string {
  return `${base} ${variants[variant]} ${extra}`.trim();
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, className)} {...props} />;
}
