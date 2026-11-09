import { z } from "zod";
const plain = (min: number, max: number) => z.string().trim().min(min).max(max).refine(value => [...value].length >= min && [...value].length <= max && !/<\/?[a-z][^>]*>/i.test(value) && ![...value].some(char => char.charCodeAt(0) < 32 && !"\n\r\t".includes(char)), "Use plain text without HTML or scripts");
export const reviewIdSchema = z.string().uuid();
export const reviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5), name: plain(2, 50),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  title: plain(0, 100).optional(), comment: plain(10, 1000),
  website: z.string().max(200).optional().default(""),
}).strict().refine(value => !value.website.trim(), "Review could not be submitted");
export const moderationSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]), reason: plain(0, 500).optional() }).strict();
export const publicReviewQuery = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10), sort: z.enum(["newest","highest","lowest"]).default("newest") });
export const adminReviewQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING","APPROVED","REJECTED"]).optional(), rating: z.coerce.number().int().min(1).max(5).optional(),
  productId: z.string().uuid().optional(), id: z.string().uuid().optional(), search: z.string().trim().max(160).optional(),
  dateFilter: z.enum(["all","today","7","30","90"]).default("all"), from: z.iso.date().optional(), to: z.iso.date().optional(),
}).refine(value => !value.from || !value.to || value.from <= value.to, "Start date must not be after end date");
export const summaryQuery = z.object({ ids: z.string().max(4000).transform(value => [...new Set(value.split(","))]).pipe(z.array(z.string().uuid()).min(1).max(100)) });
export const productLookupQuery = z.object({ search: z.string().trim().max(160).default("") });
