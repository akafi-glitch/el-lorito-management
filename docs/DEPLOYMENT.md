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
| `RECEIPT_PAPER_WIDTH_MM` | No | `80` (default) or `58`: the thermal printer's paper width |

The app refuses to start pages if a value is missing, if the keys are swapped, or if any
`NEXT_PUBLIC_` variable holds a secret key.

## Live project status

| Migration | Live project (`yshypzeuqzgattkvmzak`) |
| --- | --- |
| `20261027030000_app_users` | Applied Oct 26, 2026, after pull request #1 was merged |
| `20261027040000_floor_layout` | Applied Oct 26, 2026, after pull request #2 was merged |
| `20261027050000_seating` | Applied Oct 26, 2026, after pull request #3 was merged |
| `20261027060000_staff` | Applied Oct 27, 2026, after pull request #4 was merged |
| `20261027070000_menu` | Applied Oct 27, 2026, when pull request #6 was merged |
| `20261027080000_tickets` | Applied Oct 27, 2026, when pull request #7 was merged |
| `20261027090000_ticket_totals` | Applied Oct 27, 2026, when pull request #8 was merged |
| `20261027100000_printing` | Not yet: applied when pull request #9 is merged |

**Merging applies migrations.** Since the staff migration, Supabase applies a migration to the
live project by itself as soon as its pull request is merged into `main` (Supabase's GitHub
integration; the history shows these with no "created by"). So approving and merging a pull
request with a migration changes the live database. After each merge, the live tables, privileges,
and Supabase's security advisor are checked.

**Live data added on the owner's request (Oct 27, 2026):** 16 employees, all as waiters: Rene 1,
Alex 2, Sofia 3, Ali 4, Maria 5, Lalo 6, Elizabeth 7, Cin 8, Abdullah 9, Isa 10, Gabi 11, Liz 12,
Chuy 13, Ashley 17, Deirha 18, Alvaro 20. Change anyone's role on Management → Employees.
The live migration history uses the same version numbers as these files, so `supabase db push`
only sends what's missing. A separate free test project is recommended before opening day.

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
