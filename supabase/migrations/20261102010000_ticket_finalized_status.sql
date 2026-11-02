-- A ticket can now be FINALIZED: the customer receipt was printed and the waiter confirmed it.
--
-- On its own in this file because Postgres can't use a new enum value in the transaction that adds
-- it; the next migrations use it. 'printed' stays for tickets locked the old way (history unchanged).
alter type public.ticket_status add value if not exists 'finalized';
