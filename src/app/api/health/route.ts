import { NextResponse } from "next/server";

import { isServerEnvValid } from "@/lib/env";

import packageJson from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Public health check. Reports whether the app is configured, never the configuration itself.
 * Returns 503 when configuration is missing or wrong.
 */
export function GET() {
  const configValid = isServerEnvValid();
  return NextResponse.json(
    {
      status: configValid ? "ok" : "misconfigured",
      app: "el-lorito-management",
      version: packageJson.version,
      config: configValid ? "valid" : "invalid",
    },
    { status: configValid ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
