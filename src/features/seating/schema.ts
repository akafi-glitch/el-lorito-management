import { z } from "zod";

import { MAX_GUESTS } from "./recommend";

const tableCode = z.string().regex(/^[A-Z0-9-]{1,12}$/, "Unknown table.");

export const seatPartySchema = z.object({
  tableCodes: z
    .array(tableCode)
    .min(1, "Choose at least one table.")
    .max(12, "Choose 12 tables or fewer.")
    .refine((codes) => new Set(codes).size === codes.length, "A table was chosen twice."),
  guestCount: z
    .number({ message: "Enter the number of guests." })
    .int("Enter a whole number of guests.")
    .min(1, `Enter a number of guests from 1 to ${MAX_GUESTS}.`)
    .max(MAX_GUESTS, `Enter a number of guests from 1 to ${MAX_GUESTS}.`),
  combinationCode: z.string().regex(/^[A-Z0-9+]{3,24}$/).nullable().default(null),
});

export const visitChangeSchema = z.object({
  visitId: z.number().int().positive(),
  version: z.number().int().positive(),
});

export const sectionOpenSchema = z.object({
  sectionCode: z.string().regex(/^[A-Z0-9-]{1,8}$/),
  isOpen: z.boolean(),
});

export type SeatPartyInput = z.input<typeof seatPartySchema>;
export type VisitChangeInput = z.input<typeof visitChangeSchema>;
export type SectionOpenInput = z.input<typeof sectionOpenSchema>;

export type { ActionResult } from "@/lib/action-result";
