import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isPublicPath, safeNextPath } from "@/features/auth/redirect";
import { parsePublicEnv } from "@/lib/env-schema";

/**
 * Runs before every page request: refreshes the sign-in session cookie and sends
 * anyone who isn't signed in to /sign-in. Fails closed: if configuration is broken,
 * only the public pages open.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  let env;
  try {
    env = parsePublicEnv(process.env);
  } catch {
    return isPublic ? NextResponse.next({ request }) : redirectToSignIn(request, pathname + search);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not put code between client creation and getClaims(): it would race the session refresh.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    signedIn = false;
  }

  if (!signedIn && !isPublic) return redirectToSignIn(request, pathname + search);

  if (signedIn && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = safeNextPath(request.nextUrl.searchParams.get("next"));
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

function redirectToSignIn(request: NextRequest, returnTo: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  const next = safeNextPath(returnTo);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}
