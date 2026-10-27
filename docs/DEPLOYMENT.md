# Deployment

This is the step-by-step guide for putting the app online with **Vercel** (the website) and the
**Supabase** project you already have (the database and sign-in). Nothing deploys by itself until
you connect Vercel, and nothing paid is switched on for you.

**Never paste a secret key into a chat, an email, or a file you commit.** Secret keys go only
into Vercel's settings and your own `.env.local` (which Git ignores).

---

## 0. Before you start: two cost decisions (yours)

| Service | Free plan | What to know |
| --- | --- | --- |
| **Vercel** | Hobby | Vercel's rules limit Hobby to **non-commercial personal use**; any deployment used for anyone's financial gain needs **Pro** ([fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines)). A restaurant's staff app very likely counts as commercial, so plan on **Pro** (check vercel.com/pricing), or ask Vercel support. |
| **Supabase** | Free | Your project is on Free. Free projects are **paused after about a week without activity** (daily use keeps it awake), and **daily backups are a paid-plan feature**. For real restaurant data, consider **Pro** (check supabase.com/pricing). |

Both can be changed later without changing any code.

---

## 1. Supabase settings (dashboard, about 5 minutes)

Project: **akafi-glitch's El Lorito** (`yshypzeuqzgattkvmzak`, region us-east-1).
The database itself is already set up: every migration was applied when its pull request was
merged (Database → Migrations shows them).

1. **Authentication → Sign In / Providers**
   - **Email**: must stay **enabled** (administrators sign in with a username and password).
   - **Allow new users to sign up**: turn **off**. Only administrators create accounts.
   - In the password settings under Authentication (shown with the Email provider), set the
     **minimum password length** to **10** (the app asks for 10).
   - **Leaked password protection** (refuses passwords known from data breaches): switch it on if
     your plan offers it (Supabase lists it for Pro and above). Supabase's Security Advisor warns
     while it is off; that warning is the only one expected.
2. **Authentication → URL Configuration**
   - **Site URL**: your Vercel address once you have it (step 3), for example
     `https://el-lorito-management.vercel.app`. Later, your own domain.
3. **Realtime → Settings**
   - Turn **off** "Allow public access", so only private channels are allowed. The app only uses
     one private channel, and the database already decides who may listen.
4. **Project Settings → API Keys**
   - You'll copy three values in steps 2 and 3: the **Project URL**, the **Publishable key**
     (`sb_publishable_…`), and a **Secret key** (`sb_secret_…`; create one if none is listed).

---

## 2. Create the first administrator (on your laptop, once)

Nobody can sign in until an administrator exists. In the project folder (the one you opened in
VS Code), in a terminal:

```bash
git pull                        # get the latest main
npm install
cp .env.example .env.local      # then open .env.local and paste:
                                #   NEXT_PUBLIC_SUPABASE_URL=            (Project URL)
                                #   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= (Publishable key)
                                #   SUPABASE_SECRET_KEY=                  (Secret key)
npm run admin:create            # asks for a username, a display name, and a password (hidden)
```

Use a username like `kafi` or `manager` and a password of at least 10 characters. More accounts
can be added later in the app: **Management → Sign-in accounts**.

`.env.local` now points at the **live** project. That is fine for `admin:create`. Don't run the
browser tests against it (they refuse to anyway; they only run against a local Supabase).

---

## 3. Vercel (about 10 minutes)

1. Sign in at **vercel.com** with GitHub. Choose your plan (see step 0).
2. **Add New → Project → Import** the GitHub repository `akafi-glitch/el-lorito-management`.
   If it isn't listed, use "Adjust GitHub App Permissions" to give Vercel access to that repository.
3. **Configure Project** (most of it is detected automatically):
   - Framework Preset: **Next.js**. Root Directory: `./`.
   - Build Command: leave the default (it runs `npm run build`, which also runs the secret-key scan).
   - Node.js version: **22.x** (read from `package.json`).
4. **Environment Variables**: add these for **Production only** (untick Preview and Development):

   | Name | Value | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key | `sb_publishable_…` |
   | `SUPABASE_SECRET_KEY` | Secret key | `sb_secret_…`. Mark it **Sensitive** |
   | `APP_TIME_ZONE` | `America/Chicago` | |
   | `RECEIPT_PAPER_WIDTH_MM` | `80` | `58` if your printer paper is 58 mm |

   Why Production only: preview deployments (one per pull request) then have no keys, so they can
   never read or change the live restaurant data. They build, show "misconfigured" at
   `/api/health`, and refuse to show pages.
5. Click **Deploy**. When it finishes you get an address like `https://el-lorito-management.vercel.app`.
6. Put that address in Supabase → Authentication → URL Configuration → **Site URL** (step 1.2).
7. **Region**: Vercel runs the app's server code in Washington, D.C. (`iad1`) by default, next to
   your Supabase project (us-east-1). Nothing to change.

**From now on, every merge into `main` deploys to production automatically** (Vercel watches the
repository), and any migration in it is applied to the live database (Supabase watches it too).
Merging a pull request *is* releasing it.

If you change an environment variable in Vercel, **redeploy** (Deployments → ⋯ → Redeploy): the
`NEXT_PUBLIC_` values are built into the pages.

---

## 4. First-deployment checks (15 minutes, at the restaurant if possible)

1. Open `https://<your address>/api/health`: it should say `"status":"ok"`.
2. Open the address, sign in with the administrator from step 2.
3. **Management → Shift and sections → Start shift.** Assign waiters and chips runners.
   (The 16 waiters are already in **Employees**; change roles there if someone is a chips runner
   or manager.)
4. **Live updates:** open **Floor Management** on two devices. The dot under the title should say
   **Live** within a few seconds. Seat a table on one: it should turn yellow on the other within
   about a second. Then mark chips served and clear it.
   - The live project's Realtime storage is created by Supabase when the first app connects, so
     the very first minute may say "Reconnecting" (the screens still update every 5 seconds). If it
     keeps saying "Reconnecting" after a few minutes, check step 1.3 and tell your developer.
5. **Waiter Section:** enter a waiter number (e.g. `1` for Rene), open a seated table, add items,
   **Save ticket**. Check the taxes and total.
6. **Printing** (connect the thermal printer to the device and make it the default printer first):
   - Note: printing locks a ticket for good and its number is used up. The first printed ticket
     will be #1001; you can use a real order for this check.
   - In the browser's print dialog choose the thermal printer, **paper size 80 mm** (or 58 mm),
     **margins: none**, **scale: 100%**, and untick **Headers and footers**. Chrome remembers these.
   - Answer **"Did it print?"** honestly; No offers **Print again**.
   - If the receipt is cut off or too narrow, set `RECEIPT_PAPER_WIDTH_MM` (step 3.4) and redeploy.
7. Sign out on shared devices you don't want left signed in. To lock out a lost tablet at once:
   **Management → Sign-in accounts → Turn off** its account (every page and action checks this).

---

## 5. Later

- **Your own domain** (`ellorito-management.com`, not bought yet): buy it from any registrar, then
  Vercel → Project → Settings → **Domains** → add it and follow the DNS steps. Then update the
  Supabase **Site URL**.
- **Rolling back the app:** Vercel → Deployments → pick the last good one → **Promote to
  Production**. Database changes are not rolled back by this; they need a new migration.
- **Backups:** on Supabase Free there are no daily backups. Either upgrade to Pro, or regularly
  download a backup (Database → Backups, or `supabase db dump` with the database password).
- **Silent printing** (no print dialog) is out of scope for now; it needs a dedicated set-up per
  device and the printer model.

---

## Environment variables (reference)

| Variable | Browser can see it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | **Never** | `sb_secret_…`; server only |
| `APP_TIME_ZONE` | No | Default `America/Chicago` |
| `RECEIPT_PAPER_WIDTH_MM` | No | `80` (default) or `58`: the thermal printer's paper width |

The app refuses to show pages if a value is missing, if the keys are swapped, or if any
`NEXT_PUBLIC_` variable holds a secret key. The build fails if a secret key reaches browser files.

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
| `20261027100000_printing` | Applied Oct 27, 2026, when pull request #9 was merged |
| `20261027110000_live_sync` | Applied Oct 27, 2026, when pull request #10 was merged |
| `20261027120000_hardening` | Applied Oct 27, 2026, when pull request #12 was merged |

**Merging applies migrations.** Supabase's GitHub integration applies a migration to the live
project as soon as its pull request is merged into `main` (the history shows these with no
"created by"). After each merge, the live tables, privileges, and Supabase's security advisor are
checked.

**Live data added on the owner's request (Oct 27, 2026):** 16 employees, all as waiters: Rene 1,
Alex 2, Sofia 3, Ali 4, Maria 5, Lalo 6, Elizabeth 7, Cin 8, Abdullah 9, Isa 10, Gabi 11, Liz 12,
Chuy 13, Ashley 17, Deirha 18, Alvaro 20. No sign-in accounts, visits, or tickets exist yet.

## Live updates (Supabase Realtime), technical notes

- Realtime **broadcast** on one **private** channel, `restaurant`; the migration adds the database
  rule that lets only active administrator accounts listen. Signals carry only a topic and a version.
- Found Oct 27, 2026: the live project's `realtime.messages` had no daily partitions yet (Realtime
  creates them once an app connects), so signals sent before then are dropped quietly. Screens
  update through the 5-second check until then.
- Local `supabase start`: Realtime may create `realtime.messages` after the migrations run. Run
  `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/ensure-realtime-policy.sql`
  once afterwards (CI does this).
- CI tests the live path on every pull request against a real local Supabase with Realtime.

## Local development

See the README. A second, free Supabase project for testing (separate from the live one) is
recommended before making bigger changes; point `.env.local` at it instead of the live project.
