-- Phase 8: tax and ticket totals.
--
-- Rules (owner decisions; rounding approved Oct 27, 2026):
-- * Food and nonalcoholic drinks: food tax 8.5% (850 basis points). Beer and cocktails (wine is
--   on the cocktail page): liquor tax 10.5% (1050). Rates are data in tax_groups.
-- * Food subtotal and liquor subtotal are added up separately, each from the ticket's lines.
-- * Each tax is worked out ONCE on its subtotal and rounded to the cent, half a cent up:
--   tax = round_half_up(subtotal x rate). Example: $7.50 food -> $0.6375 -> $0.64;
--   $5.25 beer -> $0.55125 -> $0.55. Total = food sub + liquor sub + food tax + liquor tax = $13.94.
-- * Whole cents and integer arithmetic only: (subtotal_cents x rate_bp + 5000) / 10000.
-- * The same rule runs in the app (src/features/billing/tax.ts) for the on-screen preview; both are
--   tested with the same examples. When a ticket is printed (Phase 9) its totals are frozen.

-------------------------------------------------------------------------------
-- tax_cents: one tax amount, rounded half up to the cent.
-------------------------------------------------------------------------------
create function public.tax_cents(p_subtotal_cents bigint, p_rate_bp integer)
returns bigint
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_subtotal_cents < 0 or p_rate_bp < 0 then null  -- never negative money
    else (p_subtotal_cents * p_rate_bp + 5000) / 10000
  end
$$;

-------------------------------------------------------------------------------
-- ticket_totals: every ticket's subtotals, taxes, and total at the current rates.
-------------------------------------------------------------------------------
create view public.ticket_totals
with (security_invoker = true)
as
with sums as (
  select t.id as ticket_id,
         t.ticket_number,
         t.visit_id,
         coalesce(sum(l.unit_price_cents::bigint * l.quantity) filter (where l.tax_group_code = 'food'), 0)::bigint   as food_subtotal_cents,
         coalesce(sum(l.unit_price_cents::bigint * l.quantity) filter (where l.tax_group_code = 'liquor'), 0)::bigint as liquor_subtotal_cents
    from public.tickets t
    left join public.ticket_lines l on l.ticket_id = t.id
   group by t.id
),
rates as (
  select max(rate_bp) filter (where code = 'food')   as food_rate_bp,
         max(rate_bp) filter (where code = 'liquor') as liquor_rate_bp
    from public.tax_groups
)
select s.ticket_id,
       s.ticket_number,
       s.visit_id,
       s.food_subtotal_cents,
       s.liquor_subtotal_cents,
       r.food_rate_bp,
       r.liquor_rate_bp,
       public.tax_cents(s.food_subtotal_cents, r.food_rate_bp)     as food_tax_cents,
       public.tax_cents(s.liquor_subtotal_cents, r.liquor_rate_bp) as liquor_tax_cents,
       s.food_subtotal_cents + s.liquor_subtotal_cents
         + public.tax_cents(s.food_subtotal_cents, r.food_rate_bp)
         + public.tax_cents(s.liquor_subtotal_cents, r.liquor_rate_bp) as total_cents
  from sums s
 cross join rates r;

-- The two tax groups must exist for the totals to make sense.
alter table public.tax_groups add constraint tax_groups_known_codes check (code in ('food', 'liquor'));

-------------------------------------------------------------------------------
-- Security
-------------------------------------------------------------------------------
revoke all on table public.ticket_totals from anon, authenticated;
grant select on table public.ticket_totals to service_role;

revoke execute on function public.tax_cents(bigint, integer) from public, anon, authenticated;
grant execute on function public.tax_cents(bigint, integer) to service_role;
