import { z } from "zod";

export const phoneSchema = z.string().trim().min(7).max(20)
  .regex(/^\+?[\d\s()-]+$/, "Enter a valid phone number")
  .refine(value => { const digits = value.replace(/\D/g, ""); return digits.length >= 7 && digits.length <= 15; }, "Enter a valid phone number");

export const plainText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum)
  .refine(value => !/<\/?[a-z][^>]*>/i.test(value) && [...value].every(character => {
    const code = character.charCodeAt(0);
    return code >= 32 || code === 9 || code === 10 || code === 13;
  }), "Use plain text without HTML or control characters");

export const inputDateSchema = z.preprocess(value => {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return undefined;
  return value;
}, z.coerce.date());
