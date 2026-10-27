"use client";

import Link from "next/link";

import { Button, buttonClasses } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center" role="alert">
      <h1 className="text-3xl font-bold text-ink">This page couldn&apos;t load</h1>
      <p className="max-w-md text-lg text-muted">
        The app couldn&apos;t reach the database or hit an unexpected problem. Check the internet connection, then try
        again.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonClasses("secondary")}>
          Go to home
        </Link>
      </div>
    </main>
  );
}
