#!/usr/bin/env bash
# Two devices change the same thing at the same moment: exactly one may win, and nothing deadlocks.
# Runs two real database connections at once against a DISPOSABLE local database
# (the CI database, or `npx supabase start`). It leaves test visits behind, so it refuses
# to run against anything that isn't on this computer.
#
#   bash scripts/db-race-test.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
set -euo pipefail

DB_URL="${1:?Pass the local database URL}"
case "$DB_URL" in
  *@127.0.0.1:*|*@localhost:*|*host=/*) ;;
  *) echo "Refusing: $DB_URL is not a local database." >&2; exit 2 ;;
esac

PSQL=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -At)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail=0

open_visits() {
  "${PSQL[@]}" -c "select count(*) from public.visit_tables vt join public.restaurant_tables t on t.id = vt.table_id
                   where t.code = any (string_to_array('$1', ',')) and vt.released_at is null"
}

# Free the tables used here (from an earlier run) by closing their visits the normal way.
reset_tables() {
  "${PSQL[@]}" >/dev/null <<SQL
update public.sections set is_open = true;
select public.mark_chips_served(cv.id, cv.version, null)
  from public.customer_visits cv
 where cv.cleared_at is null and cv.chips_status = 'needed'
   and exists (select 1 from public.visit_tables vt join public.restaurant_tables t on t.id = vt.table_id
               where vt.visit_id = cv.id and vt.released_at is null and t.code = any (string_to_array('$1', ',')));
select public.clear_visit(cv.id, cv.version, null)
  from public.customer_visits cv
 where cv.cleared_at is null
   and exists (select 1 from public.visit_tables vt join public.restaurant_tables t on t.id = vt.table_id
               where vt.visit_id = cv.id and vt.released_at is null and t.code = any (string_to_array('$1', ',')));
SQL
}

echo "Race 1: two hosts seat A6 at the same moment"
reset_tables "A6"
( "${PSQL[@]}" -c "begin; select public.seat_party(array['A6'], 2, null); select pg_sleep(2); commit;" \
    >"$work/first.out" 2>&1; echo $? >"$work/first.code" ) &
sleep 0.5
( "${PSQL[@]}" -c "select public.seat_party(array['A6'], 3, null);" >"$work/second.out" 2>&1; echo $? >"$work/second.code" ) &
wait
if [ "$(cat "$work/first.code")" = 0 ] && grep -q "table_occupied" "$work/second.out" && [ "$(open_visits A6)" = 1 ]; then
  echo "  PASS: first host seated A6; second host was told A6 is taken; A6 has one visit"
else
  echo "  FAIL"; cat "$work"/*.out; fail=1
fi

echo "Race 2: two hosts join the same two tables in opposite order (deadlock check)"
reset_tables "A5,B5"
( "${PSQL[@]}" -c "begin; select public.seat_party(array['A5','B5'], 8, null); select pg_sleep(2); commit;" \
    >"$work/third.out" 2>&1; echo $? >"$work/third.code" ) &
sleep 0.5
( "${PSQL[@]}" -c "select public.seat_party(array['B5','A5'], 8, null);" >"$work/fourth.out" 2>&1; echo $? >"$work/fourth.code" ) &
wait
if grep -q "deadlock" "$work"/*.out; then
  echo "  FAIL: deadlock"; cat "$work"/*.out; fail=1
elif [ "$(cat "$work/third.code")" = 0 ] && grep -q "table_occupied" "$work/fourth.out" && [ "$(open_visits A5,B5)" = 2 ]; then
  echo "  PASS: one host seated A5 + B5; the other was told they're taken; no deadlock"
else
  echo "  FAIL"; cat "$work"/*.out; fail=1
fi

# A waiter for the ticket races (number 990001, added once).
EMP=$("${PSQL[@]}" -c "select coalesce((select id from public.employees where number_key = '990001'),
                                         public.add_employee('990001', 'Race Waiter', 'waiter', null))")
LINES() { echo "[{\"item_id\": $("${PSQL[@]}" -c "select id from public.menu_items where name = 'Taco'"), \"quantity\": $1}]"; }

echo "Race 3: two waiters save the same ticket at the same moment"
reset_tables "C6"
VISIT=$("${PSQL[@]}" -c "select public.seat_party(array['C6'], 2, null)")
TICKET=$("${PSQL[@]}" -c "select ticket_id from public.save_ticket($VISIT, null, null, $EMP, '$(LINES 1)', 'America/Chicago', null)")
( "${PSQL[@]}" -c "begin; select * from public.save_ticket($VISIT, $TICKET, 1, $EMP, '$(LINES 2)', 'America/Chicago', null); select pg_sleep(2); commit;" \
    >"$work/fifth.out" 2>&1; echo $? >"$work/fifth.code" ) &
sleep 0.5
( "${PSQL[@]}" -c "select * from public.save_ticket($VISIT, $TICKET, 1, $EMP, '$(LINES 3)', 'America/Chicago', null);" \
    >"$work/sixth.out" 2>&1; echo $? >"$work/sixth.code" ) &
wait
QTY=$("${PSQL[@]}" -c "select quantity from public.ticket_lines where ticket_id = $TICKET")
if [ "$(cat "$work/fifth.code")" = 0 ] && grep -q "stale_ticket" "$work/sixth.out" && [ "$QTY" = 2 ]; then
  echo "  PASS: the first save won (2 tacos); the second was told the ticket changed"
else
  echo "  FAIL"; cat "$work/fifth.out" "$work/sixth.out"; fail=1
fi

echo "Race 4: the table is cleared while a waiter saves a ticket"
( "${PSQL[@]}" -c "begin;
    select public.clear_visit($VISIT, public.mark_chips_served($VISIT, (select version from public.customer_visits where id = $VISIT), null), null);
    select pg_sleep(2); commit;" >"$work/seventh.out" 2>&1; echo $? >"$work/seventh.code" ) &
sleep 0.5
( "${PSQL[@]}" -c "select * from public.save_ticket($VISIT, null, null, $EMP, '$(LINES 1)', 'America/Chicago', null);" \
    >"$work/eighth.out" 2>&1; echo $? >"$work/eighth.code" ) &
wait
if [ "$(cat "$work/seventh.code")" = 0 ] && grep -q "visit_closed" "$work/eighth.out" \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.tickets where visit_id = $VISIT")" = 1 ]; then
  echo "  PASS: the save waited for the clearing, then was refused; no ticket was added to the closed visit"
else
  echo "  FAIL"; cat "$work/seventh.out" "$work/eighth.out"; fail=1
fi

exit $fail
