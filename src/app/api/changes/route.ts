import { NextResponse } from "next/server";

import { getSessionState } from "@/features/auth/session";
import { loadVersions } from "@/features/sync/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/changes: the version of each topic (floor, staff, menu, tickets), so a screen whose
 * live connection dropped can tell whether it needs to reload. Signed-in, active accounts only.
 * Holds no restaurant data.
 */
export async function GET() {
  const session = await getSessionState();
  if (session.status !== "signed-in") {
    return NextResponse.json({ error: "signed-out" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return NextResponse.json(await loadVersions(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
