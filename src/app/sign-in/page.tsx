import type { Metadata } from "next";
import Image from "next/image";

import { safeNextPath } from "@/features/auth/redirect";
import { SignInForm } from "@/features/auth/sign-in-form";
import { isServerEnvValid } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

type SignInPageProps = { searchParams: Promise<{ next?: string }> };

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next } = await searchParams;
  const configured = isServerEnvValid();

  return (
    <main className="tile-pattern flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <Image
        src="/el-lorito-logo.webp"
        alt="El Lorito"
        width={625}
        height={795}
        priority
        className="h-auto w-44 sm:w-56"
      />
      <div className="w-full max-w-sm rounded-2xl border border-glaze bg-paper p-6 shadow-[0_2px_0_var(--color-glaze)] sm:p-8">
        <h1 className="mb-6 text-2xl font-bold text-ink">Sign in</h1>
        {configured ? (
          <SignInForm next={safeNextPath(next)} />
        ) : (
          <p role="alert" className="text-base text-ink">
            The app isn&apos;t set up yet: its database settings are missing. See the README section
            &ldquo;Local setup&rdquo;.
          </p>
        )}
      </div>
    </main>
  );
}
