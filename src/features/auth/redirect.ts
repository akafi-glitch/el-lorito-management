/** Routes anyone may open without signing in. */
export const PUBLIC_PATHS = ["/sign-in", "/api/health"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Where to go after signing in. Only same-site paths are allowed, so a crafted link
 * like `/sign-in?next=https://evil.example` can't send someone to another website.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/sign-in")) return "/";
  return next;
}
