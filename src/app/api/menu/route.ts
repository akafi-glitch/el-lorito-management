import { NextResponse } from "next/server";

import { getSessionState } from "@/features/auth/session";
import { loadMenuData } from "@/features/menu/queries";
import { loadVersions } from "@/features/sync/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/menu?v=12: the menu and tax setup for ordering screens. Signed-in, active accounts only.
 * The link names the menu version, so the browser may keep the answer; a new version is a new link.
 */
export async function GET() {
  const session = await getSessionState();
  if (session.status !== "signed-in") {
    return NextResponse.json({ error: "signed-out" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { menu: version } = await loadVersions();
    return NextResponse.json(await loadMenuData(version), { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
