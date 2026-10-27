/**
 * HTTP security headers for every response (used by next.config.ts, unit tested).
 *
 * - The page may only load its own scripts, styles, and images, and may only talk to itself and
 *   the Supabase project (for live updates). Next.js needs inline scripts and styles, so those stay
 *   allowed; everything from other sites is refused.
 * - No other site may show the app in a frame (stops click-jacking).
 * - On Vercel (always HTTPS), browsers are told to use HTTPS only, for two years.
 */

export type Header = { key: string; value: string };

export function contentSecurityPolicy(options: { supabaseUrl?: string; development: boolean; https: boolean }): string {
  const connect = ["'self'"];
  if (options.supabaseUrl) {
    const url = new URL(options.supabaseUrl);
    connect.push(url.origin, `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
  }
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}${options.development ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (options.https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function securityHeaders(env: Record<string, string | undefined>): Header[] {
  const onVercel = env.VERCEL === "1";
  const headers: Header[] = [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy({
        supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || undefined,
        development: env.NODE_ENV === "development",
        https: onVercel,
      }),
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
  if (onVercel) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return headers;
}
