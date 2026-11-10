import { z } from "zod";
export const fixedOfferCode=z.enum(["FIRST_ORDER","BIG_ORDER"]);
export const updateOfferSchema=z.object({
 version:z.number().int().positive(),
 percentage:z.number().finite().gt(0).max(100).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-8,"Use at most two decimal places").optional(),
 minOrderAmount:z.number().int().positive().max(999999999999).optional(),
 enabled:z.boolean().optional(),
}).strict().refine(value=>value.percentage!==undefined||value.minOrderAmount!==undefined||value.enabled!==undefined,"No offer changes supplied");
