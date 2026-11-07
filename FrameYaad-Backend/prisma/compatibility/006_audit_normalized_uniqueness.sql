-- Precondition: prisma/audit-duplicates.ts reports no conflicting groups.
-- Additive constraints only: never rewrites or removes existing rows.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Product_normalized_identifier_key" ON public."Product" (LOWER(BTRIM("productIdentifier")));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Material_normalized_brand_name_key" ON public."Material" (LOWER(BTRIM("brandName")), LOWER(BTRIM(name)));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProductVariant_configuration_normalized_key" ON public."ProductVariant" ("productId", LOWER(BTRIM(color)), LOWER(BTRIM("frameSize")), LOWER(BTRIM("mountType")), "glassType", mrp, price) WHERE "productId" IS NOT NULL;
