import { z } from "zod";

export const newsletterEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address").max(320),
}).strict();

export const newsletterListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(320).optional(),
  status: z.enum(["ACTIVE", "UNSUBSCRIBED"]).optional(),
});

export const newsletterExportQuerySchema = newsletterListQuerySchema.pick({
  search: true,
  status: true,
});

export type NewsletterEmailInput = z.infer<typeof newsletterEmailSchema>;
export type NewsletterListQuery = z.infer<typeof newsletterListQuerySchema>;

