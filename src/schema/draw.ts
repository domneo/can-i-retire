// Response schemas. `z` comes from @hono/zod-openapi rather than from zod so
// that .openapi() metadata exists on every schema; it is Zod 4 underneath.
//
// Phase 4 adds the domain refinements (six distinct numbers, additional not
// among them, and so on) on top of these shapes.

import { z } from "@hono/zod-openapi";

export const DrawNoParam = z.object({
  drawNo: z.coerce
    .number()
    .int()
    .positive()
    .openapi({ param: { name: "drawNo", in: "path" }, example: 4217 }),
});

export const ErrorSchema = z
  .object({ error: z.string().openapi({ example: "draw not found" }) })
  .openapi("Error");

const PrizeGroupSchema = z
  .object({
    group: z.number().int().min(1).max(7).openapi({ example: 1 }),
    shareCents: z
      .number()
      .int()
      .nullable()
      .openapi({
        example: 585378200,
        description: "null when the page shows '-'",
      }),
    winners: z.number().int().nullable().openapi({ example: 0 }),
  })
  .openapi("TotoPrizeGroup");

const OutletSchema = z
  .object({
    group: z.number().int().openapi({ example: 2 }),
    name: z.string().openapi({ example: "Singapore Pools Account Bet" }),
    address: z.string().nullable(),
    entry: z
      .string()
      .nullable()
      .openapi({ example: "1 QuickPick System 7 Entry" }),
  })
  .openapi("TotoOutlet");

export const TotoDrawSchema = z
  .object({
    game: z.literal("toto"),
    drawNo: z.number().int().openapi({ example: 4217 }),
    drawDate: z.string().openapi({ example: "2026-09-14" }),
    numbers: z.array(z.number().int().min(1).max(49)).openapi({
      example: [2, 14, 16, 21, 36, 47],
    }),
    additional: z.number().int().min(1).max(49).openapi({ example: 1 }),
    group1PrizeCents: z.number().int().nullable(),
    snowballed: z.boolean(),
    cascadeDraw: z.boolean(),
    prizeGroups: z.array(PrizeGroupSchema),
    outlets: z.array(OutletSchema),
    scrapedAt: z.string().openapi({ example: "2026-09-15 03:12:44" }),
  })
  .openapi("TotoDraw");

export const FourDDrawSchema = z
  .object({
    game: z.literal("4d"),
    drawNo: z.number().int().openapi({ example: 5535 }),
    drawDate: z.string().openapi({ example: "2026-09-13" }),
    // Strings, not numbers: '0427' is a distinct 4D number from 427.
    first: z
      .string()
      .regex(/^\d{4}$/)
      .openapi({ example: "8608" }),
    second: z
      .string()
      .regex(/^\d{4}$/)
      .openapi({ example: "4918" }),
    third: z
      .string()
      .regex(/^\d{4}$/)
      .openapi({ example: "9832" }),
    starter: z
      .array(z.string().regex(/^\d{4}$/))
      .openapi({ example: ["0427"] }),
    consolation: z
      .array(z.string().regex(/^\d{4}$/))
      .openapi({ example: ["0217"] }),
    scrapedAt: z.string().openapi({ example: "2026-09-15 03:12:44" }),
  })
  .openapi("FourDDraw");

export type TotoDrawResponse = z.infer<typeof TotoDrawSchema>;
export type FourDDrawResponse = z.infer<typeof FourDDrawSchema>;
