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

# The upgrade's order operations -------------------------------------------------------------------
ORDER_LINE() { echo "[{\"item_id\": $("${PSQL[@]}" -c "select id from public.menu_items where name = '$1' order by id limit 1"), \"quantity\": $2}]"; }
SAVE() { echo "select * from public.save_order($1, $EMP, '$2'::uuid, '$(ORDER_LINE "$3" 1)', null, 'America/Chicago', null)"; }
SAVE_AT() { echo "select * from public.save_table_order('$1', $EMP, '$2'::uuid, '$(ORDER_LINE "$3" 1)', null, 'America/Chicago', null)"; }

"${PSQL[@]}" -c "select public.start_shift(null)" >/dev/null # orders need an open shift

echo "Race 4b: two waiters send the first order at one table, with nobody seated there"
"${PSQL[@]}" -c "select public.cancel_order(t.id, t.version, $EMP, null) from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id where rt.code = 'C4' and t.status = 'open' and not t.legacy_single_order" >/dev/null
K1=$("${PSQL[@]}" -c "select gen_random_uuid()"); K2=$("${PSQL[@]}" -c "select gen_random_uuid()")
( "${PSQL[@]}" -c "begin; $(SAVE_AT C4 "$K1" Taco); select pg_sleep(1); commit;" >"$work/t1.out" 2>&1; echo $? >"$work/t1.code" ) &
sleep 0.2
( "${PSQL[@]}" -c "$(SAVE_AT C4 "$K2" Horchata);" >"$work/t2.out" 2>&1; echo $? >"$work/t2.code" ) &
wait
T=$("${PSQL[@]}" -c "select count(*) from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id where rt.code = 'C4' and t.status = 'open' and not t.legacy_single_order")
B=$("${PSQL[@]}" -c "select count(*) from public.ticket_batches b join public.tickets t on t.id = b.ticket_id join public.restaurant_tables rt on rt.id = t.table_id where rt.code = 'C4' and t.status = 'open' and not t.legacy_single_order")
if [ "$(cat "$work/t1.code")" = 0 ] && [ "$(cat "$work/t2.code")" = 0 ] && [ "$T" = 1 ] && [ "$B" = 2 ]; then
  echo "  PASS: one ticket, two orders, nobody seated"
else
  echo "  FAIL: tickets=$T orders=$B"; cat "$work/t1.out" "$work/t2.out"; fail=1
fi

echo "Race 5: two waiters send the first order at one table at the same moment"
reset_tables "C5"
VISIT=$("${PSQL[@]}" -c "select public.seat_party(array['C5'], 2, null)")
K1=$("${PSQL[@]}" -c "select gen_random_uuid()"); K2=$("${PSQL[@]}" -c "select gen_random_uuid()")
( "${PSQL[@]}" -c "begin; $(SAVE "$VISIT" "$K1" Taco); select pg_sleep(1); commit;" >"$work/o1.out" 2>&1; echo $? >"$work/o1.code" ) &
sleep 0.3
( "${PSQL[@]}" -c "$(SAVE "$VISIT" "$K2" Horchata);" >"$work/o2.out" 2>&1; echo $? >"$work/o2.code" ) &
wait
if [ "$(cat "$work/o1.code")" = 0 ] && [ "$(cat "$work/o2.code")" = 0 ] \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.tickets where visit_id = $VISIT")" = 1 ] \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.ticket_batches b join public.tickets t on t.id = b.ticket_id where t.visit_id = $VISIT")" = 2 ]; then
  echo "  PASS: one ticket, two orders; nothing overwritten"
else
  echo "  FAIL"; cat "$work/o1.out" "$work/o2.out"; fail=1
fi

echo "Race 6: the same order is pressed twice at the same moment"
K3=$("${PSQL[@]}" -c "select gen_random_uuid()")
( "${PSQL[@]}" -c "begin; $(SAVE "$VISIT" "$K3" Taco); select pg_sleep(1); commit;" >"$work/d1.out" 2>&1; echo $? >"$work/d1.code" ) &
sleep 0.3
( "${PSQL[@]}" -c "$(SAVE "$VISIT" "$K3" Taco);" >"$work/d2.out" 2>&1; echo $? >"$work/d2.code" ) &
wait
if [ "$(cat "$work/d1.code")" = 0 ] && [ "$(cat "$work/d2.code")" = 0 ] \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.ticket_batches where client_key = '$K3'")" = 1 ] \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.ticket_batches b join public.tickets t on t.id = b.ticket_id where t.visit_id = $VISIT")" = 3 ]; then
  echo "  PASS: saved once; the second press got the same order back"
else
  echo "  FAIL"; cat "$work/d1.out" "$work/d2.out"; fail=1
fi

echo "Race 7: a waiter adds an order while the customer receipt is confirmed"
TID=$("${PSQL[@]}" -c "select id from public.tickets where visit_id = $VISIT")
ATT=$("${PSQL[@]}" -c "select attempt_id from public.request_customer_receipt($TID, (select version from public.tickets where id = $TID), $EMP, null, null)")
K4=$("${PSQL[@]}" -c "select gen_random_uuid()")
( "${PSQL[@]}" -c "begin; select public.record_print_outcome($ATT, true, $EMP, null); select pg_sleep(1); commit;" >"$work/f1.out" 2>&1; echo $? >"$work/f1.code" ) &
sleep 0.3
( "${PSQL[@]}" -c "$(SAVE "$VISIT" "$K4" Taco);" >"$work/f2.out" 2>&1; echo $? >"$work/f2.code" ) &
wait
if [ "$(cat "$work/f1.code")" = 0 ] && [ "$(cat "$work/f2.code")" = 0 ] \
   && [ "$("${PSQL[@]}" -c "select status from public.tickets where id = $TID")" = finalized ] \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.ticket_batches where ticket_id = $TID")" = 3 ] \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.ticket_batches where client_key = '$K4' and ticket_id <> $TID")" = 1 ]; then
  echo "  PASS: finalized first; the late order waited and started the table's next ticket"
else
  echo "  FAIL"; cat "$work/f1.out" "$work/f2.out"; fail=1
fi

echo "Race 8: two devices confirm the same customer receipt at the same moment"
reset_tables "C4"
VISIT=$("${PSQL[@]}" -c "select public.seat_party(array['C4'], 2, null)")
K5=$("${PSQL[@]}" -c "select gen_random_uuid()")
"${PSQL[@]}" -c "$(SAVE "$VISIT" "$K5" Taco)" >/dev/null
TID=$("${PSQL[@]}" -c "select id from public.tickets where visit_id = $VISIT")
ATT=$("${PSQL[@]}" -c "select attempt_id from public.request_customer_receipt($TID, (select version from public.tickets where id = $TID), $EMP, null, null)")
( "${PSQL[@]}" -c "begin; select public.record_print_outcome($ATT, true, $EMP, null); select pg_sleep(1); commit;" >"$work/g1.out" 2>&1; echo $? >"$work/g1.code" ) &
sleep 0.3
( "${PSQL[@]}" -c "select public.record_print_outcome($ATT, true, $EMP, null);" >"$work/g2.out" 2>&1; echo $? >"$work/g2.code" ) &
wait
if [ "$(cat "$work/g1.code")" = 0 ] && [ "$(cat "$work/g2.code")" = 0 ] \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.audit_events where event_type = 'ticket_finalized' and details ->> 'ticket' = (select ticket_number::text from public.tickets where id = $TID)")" = 1 ]; then
  echo "  PASS: finalized exactly once; the second answer changed nothing"
else
  echo "  FAIL"; cat "$work/g1.out" "$work/g2.out"; fail=1
fi

echo "Race 9: a save and a kitchen print at the same moment (deadlock check)"
reset_tables "C3"
VISIT=$("${PSQL[@]}" -c "select public.seat_party(array['C3'], 2, null)")
K6=$("${PSQL[@]}" -c "select gen_random_uuid()"); K7=$("${PSQL[@]}" -c "select gen_random_uuid()")
"${PSQL[@]}" -c "$(SAVE "$VISIT" "$K6" Taco)" >/dev/null
TID=$("${PSQL[@]}" -c "select id from public.tickets where visit_id = $VISIT")
( "${PSQL[@]}" -c "begin; $(SAVE "$VISIT" "$K7" Horchata); select pg_sleep(1); commit;" >"$work/h1.out" 2>&1; echo $? >"$work/h1.code" ) &
sleep 0.3
( "${PSQL[@]}" -c "select * from public.request_kitchen_print($TID, null, $EMP, null, null);" >"$work/h2.out" 2>&1; echo $? >"$work/h2.code" ) &
wait
if grep -q "deadlock" "$work"/h*.out; then
  echo "  FAIL: deadlock"; cat "$work"/h*.out; fail=1
elif [ "$(cat "$work/h1.code")" = 0 ] && [ "$(cat "$work/h2.code")" = 0 ]; then
  echo "  PASS: both finished, one after the other; no deadlock"
else
  echo "  FAIL"; cat "$work"/h*.out; fail=1
fi

echo "Race 10: the shift finishes while a waiter sends an order"
"${PSQL[@]}" -c "select public.cancel_order(t.id, t.version, $EMP, null) from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id where rt.code in ('C2', 'C6') and t.status = 'open' and not t.legacy_single_order" >/dev/null
SHIFT=$("${PSQL[@]}" -c "select public.start_shift(null)")
K8=$("${PSQL[@]}" -c "select gen_random_uuid()"); K9=$("${PSQL[@]}" -c "select gen_random_uuid()")
( "${PSQL[@]}" -c "begin; $(SAVE_AT C2 "$K8" Taco); select pg_sleep(1); commit;" >"$work/i1.out" 2>&1; echo $? >"$work/i1.code" ) &
sleep 0.3
( "${PSQL[@]}" -c "select public.finish_shift(null);" >"$work/i2.out" 2>&1; echo $? >"$work/i2.code" ) &
wait
SAVED=$("${PSQL[@]}" -c "select count(*) from public.tickets t join public.restaurant_tables rt on rt.id = t.table_id where rt.code = 'C2' and t.status = 'open' and t.shift_id = $SHIFT")
if "${PSQL[@]}" -c "$(SAVE_AT C6 "$K9" Taco)" >"$work/i3.out" 2>&1; then REFUSED=no; else REFUSED=$(grep -c "restaurant_closed" "$work/i3.out" || true); fi
if [ "$(cat "$work/i1.code")" = 0 ] && [ "$(cat "$work/i2.code")" = 0 ] && [ "$SAVED" = 1 ] && [ "$REFUSED" = 1 ]; then
  echo "  PASS: the finish waited for the order, which counts in that shift; the next order was refused"
else
  echo "  FAIL: saved=$SAVED refused=$REFUSED"; cat "$work"/i*.out; fail=1
fi

echo "Race 11: a waiter sends an order while the shift is finishing"
"${PSQL[@]}" -c "select public.start_shift(null)" >/dev/null
K10=$("${PSQL[@]}" -c "select gen_random_uuid()")
BEFORE=$("${PSQL[@]}" -c "select count(*) from public.ticket_batches")
( "${PSQL[@]}" -c "begin; select public.finish_shift(null); select pg_sleep(1); commit;" >"$work/j1.out" 2>&1; echo $? >"$work/j1.code" ) &
sleep 0.3
( if "${PSQL[@]}" -c "$(SAVE_AT C6 "$K10" Taco);" >"$work/j2.out" 2>&1; then echo 0 >"$work/j2.code"; else echo 1 >"$work/j2.code"; fi ) &
wait
if [ "$(cat "$work/j1.code")" = 0 ] && [ "$(cat "$work/j2.code")" != 0 ] && grep -q "restaurant_closed" "$work/j2.out" \
   && [ "$("${PSQL[@]}" -c "select count(*) from public.ticket_batches")" = "$BEFORE" ]; then
  echo "  PASS: the order waited for the finish, then was refused; nothing was added"
else
  echo "  FAIL"; cat "$work"/j*.out; fail=1
fi

exit $fail

