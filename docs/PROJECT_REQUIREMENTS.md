# Project requirements

Source of truth: the approved requirements and the Phase 0 plan (Oct 26, 2026). Where an earlier
project description and a later decision differ, the later decision wins and is noted here.

## Purpose

A private web app for El Lorito Mexican Restaurant staff to manage seating, table status, chips
service, waiter assignments, food tickets, and printing, on several devices sharing one database.

## Access

- **Decided:** every page needs an administrator **username and password**. Accounts are created
  only by administrators (first one by `npm run admin:create`). No sign-up page.
- A device signs in once and stays signed in. Waiters then identify with their **employee number**
  only (no PIN). Employee numbers are identifiers, not security.
- All signed-in administrators can do everything for now; separate roles may come later.

## Floor

| Section | Tables |
| --- | --- |
| A | A1–A6 |
| B | B1–B6 |
| C | C1–C6 |
| X(1) | X1, X2, X3, X9, X10, X11, X12 |
| X(2) | X4, X5, X6, X7, X8, X13, X14 |
| P | P1–P5 and P10 (**decided**; P6–P9 do not exist) |
| Party | Party 1, Party 2, Party 3 (capacities unknown, **decided**) |
| Bar | Bar 1–4. **Decided:** tracked as tables with status colors and chips; never in the rotation; capacities unknown |

- Rotation: A → C → B → X(1) → X(2) → P, advancing after each party is seated. **Decided:** seating
  by tapping a table moves it too.
- **Decided:** closed sections can't be seated; the host opens the section first.
- Groups of 7+: Party areas first, then approved combinations. Above 12 guests only X6 + X7 + X8.
- Approved combinations: A3 + A4, B3 + B4, C3 + C4, A4 + B4, X6 + X7 + X8.
  **Decided:** combined capacity = sum of the chairs. Anyone (manager, host, or other staff) can
  also make any combination by hand; all its tables show occupied.
- **Decided:** "4ch" on the drawing means 4 chairs. Capacities are data, never hard-coded.

## Table status

Green = vacant. Yellow = seated, chips needed. Red = chips served. Gray = section closed.
Occupancy and chips status are stored separately.
**Decided:** the chips runner clears a red table ("Is the table cleaned?" Yes → green, visit closed).

## Waiter section

Employee number → current assignment → assigned tables → choose table (warning if it belongs to
another waiter, may continue) → menu → ticket → save → print → back to home.

**Decided:** any waiter can bill a Bar table, and the Bar is always offered in the waiter's table
list, alongside their assigned tables.

## Tickets

- A ticket can be changed until printed. **Decided:** printing locks it for good; every printed
  ticket is kept as printed and never voided. A waiter may print any number of tickets for the same
  table; changes after printing mean a new ticket.
- Ticket shows: restaurant name, table, waiter number (and name, pending), ticket number, date and
  time, items, quantities, prices, food subtotal, liquor subtotal, food tax 8.5%, liquor tax 10.5%, total.
- Item names and prices are copied onto the ticket, so later menu price changes never alter it.
- Printing never marks anything paid and never clears the table.

## Tax

Food and nonalcoholic drinks 8.5%; beer and cocktails (including wine) 10.5%.
Proposed rounding: per tax group on the group subtotal, half-up to the cent (needs approval).

## Out of scope

Payments, split bills, inventory, payroll, customer accounts, loyalty, kitchen display, food
modifications, special instructions, advanced analytics, multiple printers, silent printing.

## Open questions

Decided Oct 26: roles are waiter, chips runner, manager (no separate host role); Runner 2 covers
X(1), X(2), P, and Party.

Decided Oct 27: chile con queso $5.19; lunch items are served all day and cost $1.00 more from
3:00 PM; cheese-dip add-ons are ordinary menu items.

Still open: tax rounding approval, waiter name on ticket, printer model.
