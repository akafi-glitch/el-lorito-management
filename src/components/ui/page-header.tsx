import Link from "next/link";

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Shown under the description (the live-update status). */
  status?: React.ReactNode;
};

/** Title row for inner pages, with a large Home button for quick return during service. */
export function PageHeader({ title, description, status }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-glaze pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 max-w-prose text-base text-muted">{description}</p> : null}
        {status ? <div className="mt-2">{status}</div> : null}
      </div>
      <Link
        href="/"
        className="inline-flex min-h-12 items-center justify-center rounded-lg border border-glaze bg-paper px-5 font-semibold text-cobalt hover:border-cobalt"
      >
        Home
      </Link>
    </div>
  );
}
