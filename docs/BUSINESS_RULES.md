# Business rules

Rules are written as plain TypeScript functions (no screen or database code) so each can be tested
alone. The database repeats the critical checks.

Legend: **Built** = implemented and tested. **Planned** = approved, built in the phase shown.

## Access (Built, Phase 1)

- Every page except `/sign-in` and `/api/health` requires a signed-in administrator.
- Usernames: 3–32 characters, lowercase letters, numbers, dots, dashes, starting with a letter or
  number. Typed usernames are trimmed and lowercased.
- Passwords: at least 10 characters (Supabase Auth setting). Stored only as hashes by Supabase Auth.
- A turned-off account (`is_active = false`) cannot sign in and is blocked on every page.
- After sign-in the app returns to the page the person asked for, but only pages on this site.

## Seating (Planned, Phase 3)

1. Only vacant, active tables in open sections are considered. Bar is never recommended.
2. 7+ guests: Party areas first (capacity unknown → "confirm the party fits"), then approved
   combinations that fit with every table vacant. Above 12 guests only X6 + X7 + X8.
3. 6 or fewer: start at the next section in A → C → B → X(1) → X(2) → P, skipping closed sections;
   pick the smallest table that fits; else the next section.
4. Show the top 3; the host confirms; the table turns yellow showing the guest count.
5. The rotation moves to the section after the one used.
6. Manual seating: tap one or more vacant tables; ask guest count if not entered; all seated together or none.

## Table status (Planned, Phase 3)

| Color | Meaning | Action |
| --- | --- | --- |
| Green | No open visit | Seat |
| Yellow | Seated, chips needed | Chips served → red |
| Red | Chips served | Chips runner: "Is the table cleaned?" Yes → green, visit closed (tickets kept); No → stays red |
| Gray | Section closed | Not recommended; manual seating allowed |

## Tickets (Planned, Phases 7–9)

- Editable until printed. Printing locks the ticket for good; every printed ticket is kept.
- Any number of tickets per table; changes after printing mean a new ticket.
- Item name and price copied at order time; menu changes never touch old tickets.
- Ticket numbers start at 1001 and never reset (proposed).

## Tax (Planned, Phase 8; rounding needs approval)

```
Total = Food sub + Liquor sub + round(Food sub × 0.085) + round(Liquor sub × 0.105)
```

- Money is whole cents; rates are basis points (850, 1050). No floating-point money math.
- Rounding: once per group on the group subtotal, half-up to the cent.
- Example: $7.50 food + $5.25 beer → food tax $0.64, liquor tax $0.55, total **$13.94**.
