import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

/** Shown when a number in a link is unknown or turned off. */
export function WaiterRefused({ message }: { message: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 px-4 py-3 text-base font-semibold text-danger">
        {message}
      </p>
      <Link href="/waiter" className={buttonClasses("primary")}>
        Enter another number
      </Link>
    </div>
  );
}
