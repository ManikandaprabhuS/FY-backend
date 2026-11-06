-- Additive optional image associations. Existing products remain compatible.
ALTER TABLE public."ProductImage" ADD COLUMN IF NOT EXISTS color varchar(80);
ALTER TABLE public."ProductVariant" ADD COLUMN IF NOT EXISTS "imageUrl" text;
