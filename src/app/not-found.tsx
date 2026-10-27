import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold text-ink">Page not found</h1>
      <p className="max-w-md text-lg text-muted">This address doesn&apos;t match any page. Go back to the home screen.</p>
      <Link href="/" className={buttonClasses("primary")}>
        Go to home
      </Link>
    </main>
  );
}
