# Security review (Phase 12, Oct 27, 2026)

What protects the restaurant's data, what was checked before deployment, and the limits the owner
has accepted for this first version. Checked against the code in this repository and, where
noted, against the live Supabase project `yshypzeuqzgattkvmzak`.

## Summary

| Area | Status | How |
| --- | --- | --- |
| Who can open the app | ✅ | Every page and every server action needs a signed-in administrator account that is **on** (`app_users.is_active`). Turning an account off locks it out on its next click. No sign-up page. |
| Passwords | ✅ | Stored only by Supabase Auth (hashed). Minimum 10 characters (app check; set the same in Supabase, DEPLOYMENT.md step 1). Never logged, never shown. |
| Sign-in attempts | ✅ | Supabase Auth rate-limits sign-ins; the app shows "Too many sign-in attempts" on HTTP 429. One message for any wrong username or password. |
| Secret key | ✅ | Only in server-only modules (`server-only` breaks the build if browser code imports them). The build fails if a real secret key, or anything shaped like one, reaches browser files. The app refuses to run if a `NEXT_PUBLIC_` variable holds a secret key. |
| Browser access to data | ✅ live | Row Level Security is on for every table, with no browser policies. Browser roles (`anon`, `authenticated`) have no rights on any table, view, ID counter, or function in `public` (checked on the live project; enforced by `supabase/tests/hardening.test.sql` on every pull request). |
| The one browser-callable check | ✅ live | `private.is_active_staff()`: "is the signed-in account an active administrator?", answering only for the caller. Used by the Realtime rule; in a schema the API doesn't expose. |
| Live updates | ✅ live | Private Realtime channel `restaurant`; only active administrator accounts may listen (rule on `realtime.messages`); nobody may send from a browser. Signals contain only a topic and a version number, never restaurant data. |
| Changing data | ✅ | Only through server actions that check the account, validate input (Zod), and call one database function per change. Functions use `search_path = ''`, run with the caller's rights, and only the server role may run them. |
| Two devices at once | ✅ | Row locks, version numbers, and unique rules refuse conflicting changes (tested by race tests in CI). |
| History | ✅ | `audit_events` can't be edited or deleted (trigger). Visits, tickets, print requests, and assignments are kept, never deleted. |
| Money | ✅ | Whole cents, integer math; prices, tax groups, and totals copied/frozen on tickets. |
| Cross-site attacks | ✅ | Server actions check the request's origin (Next.js). React escapes all text; no raw HTML is inserted anywhere. Content Security Policy: scripts, styles, and connections only to the app itself and the Supabase project; no framing (`frame-ancestors 'none'`, `X-Frame-Options: DENY`); `nosniff`; same-origin referrer. A browser test fails if any page breaks the policy. |
| HTTPS | ✅ | Vercel serves HTTPS only; the app adds HSTS (2 years) there. |
| Public endpoints | ✅ | Only `/sign-in` and `/api/health` (which reports only "ok" or "misconfigured" and the app version). `/api/changes` needs a signed-in account. |
| Dependencies | ✅ | `npm audit`: 0 known vulnerabilities in the app's packages (Oct 27, 2026). Versions are pinned. |
| Supabase advisors | ✅ live | Security: the expected "RLS enabled, no policy" notes (intended: browsers get nothing) and "leaked password protection off" (a dashboard switch, see DEPLOYMENT.md step 1). Supabase's helper `rls_auto_enable()` was callable by browsers; the hardening migration removed that on the live project. |
| Test safety | ✅ | Browser tests refuse to run against anything but a local Supabase. Preview deployments get no keys (DEPLOYMENT.md step 3), so they can't touch live data. |

## Limits accepted for this version (owner decisions)

These are deliberate and documented in docs/PROJECT_REQUIREMENTS.md:

1. **Employee numbers are not passwords.** On a signed-in device, anyone can type any waiter's
   number. The ticket records the number used, the account (device) it came from, and the time,
   so mistakes can be traced, but this is not proof of who it was.
2. **All administrator accounts can do everything.** There are no separate manager-only rights
   yet (owner decision: everyone can access everything for now). Give accounts only to people who
   should have full access; turn accounts off when people leave.
3. **Devices stay signed in.** A shared tablet stays signed in until someone signs out. If a
   device is lost, turn its account off in **Management → Sign-in accounts**; that takes effect
   on its next click.
4. **Backups** depend on the Supabase plan (none daily on Free). See DEPLOYMENT.md, section 5.

## How each check is kept from regressing

| Check | Where |
| --- | --- |
| No browser rights on anything in `public` | `supabase/tests/hardening.test.sql` (CI, every pull request) |
| Each table and function refuses browsers | the database test file for its phase (CI) |
| No secret in browser files | `scripts/check-no-secrets.mjs` after every build (CI and Vercel) |
| Security headers | `src/config/security-headers.test.ts` (unit) and `e2e/devices.spec.ts` (no policy violations) |
| Sign-in protects every page | `e2e/auth.spec.ts`, `tests/proxy.test.ts` |
| Turned-off accounts can't listen to live updates | `supabase/tests/live_sync.test.sql` |

## Re-checking the live project

After a merge with a migration: Supabase → Advisors → **Security** should list only "RLS Enabled
No Policy" notes, plus "Leaked Password Protection Disabled" until that is switched on
(DEPLOYMENT.md step 1). The developer checks this after every merge.

Checked Oct 27, 2026 after pull request #12: hardening migration applied; on the live project no
table lacks RLS, and browsers can use no table, view, counter, or function in `public`.
