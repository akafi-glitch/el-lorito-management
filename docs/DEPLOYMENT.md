# Deployment

Nothing deploys automatically, and no paid services are started without your approval.

## Environments

| Environment | Supabase project | Where |
| --- | --- | --- |
| Local | `npx supabase start` (Docker) | Your computer |
| Development / Preview | `el-lorito-dev` (free plan) | Vercel preview deployments |
| Production | `el-lorito-prod` | Vercel production, later ellorito-management.com |

Test data and real data never share a project.

## Environment variables

| Variable | Browser can see it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | **Never** | `sb_secret_…`; server only |
| `APP_TIME_ZONE` | No | Default `America/Chicago` |

The app refuses to start pages if a value is missing, if the keys are swapped, or if any
`NEXT_PUBLIC_` variable holds a secret key.

## Supabase cloud setup (when you're ready)

1. Create the two free projects in the Supabase dashboard.
2. In each: Authentication → Sign In / Providers → turn **off** "Allow new users to sign up";
   set minimum password length to **10**. (Cloud projects do not read `config.toml`.)
3. Link and push migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
4. Create the first administrator: put that project's URL and secret key in `.env.local`, then
   `npm run admin:create`.

## Vercel setup (when you're ready)

1. Import the GitHub repo `akafi-glitch/el-lorito-management`.
2. Add the variables above per environment: Production → prod project; Preview and Development → dev project.
3. Keep Vercel deployment protection on for previews.
4. Attach ellorito-management.com only after the Phase 12 security review.

## Before going public (Phase 12 checklist)

- [ ] Sign-ups off and password length 10 in the production Supabase project
- [ ] Only production administrator accounts exist; no test accounts
- [ ] Secret key set only in Vercel's server environment
- [ ] RLS review of every table
- [ ] Database tests pass against a fresh database
