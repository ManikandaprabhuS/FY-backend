-- Preserve existing catalog rows and IDs while supplying the normalized relations.
ALTER TABLE public."Material" ADD COLUMN IF NOT EXISTS "createdBy" text;
ALTER TABLE public."Product" ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public."Product" ALTER COLUMN material DROP NOT NULL;
UPDATE public."Product" SET "productIdentifier" = 'FY-' || upper(replace(id, '-', '')) WHERE "productIdentifier" IS NULL;
UPDATE public."Product" SET "productName" = name WHERE "productName" IS NULL;
INSERT INTO public."Material" (id, name, description, "brandName", material, "availableColors", "isActive", "createdAt", "updatedAt", "createdBy")
SELECT coalesce(p."materialId", p.id), coalesce(p."productName", p.name) || ' ' || p."productIdentifier", p.description, p."brandName", p.material, coalesce(p."availableColors", ARRAY[]::text[]), p."isActive", p."createdAt", p."updatedAt", p."createdBy"
FROM public."Product" p WHERE NOT EXISTS (SELECT 1 FROM public."Material" m WHERE m.id = coalesce(p."materialId", p.id));
UPDATE public."Product" SET "materialId" = id WHERE "materialId" IS NULL;
UPDATE public."Material" SET "brandName" = coalesce("brandName", 'FrameYaad'), material = coalesce(material, name), "availableColors" = coalesce("availableColors", ARRAY[]::text[]);
ALTER TABLE public."Material" ALTER COLUMN "brandName" SET NOT NULL, ALTER COLUMN material SET NOT NULL, ALTER COLUMN "availableColors" SET DEFAULT ARRAY[]::text[], ALTER COLUMN "availableColors" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Material_brandName_name_key" ON public."Material" ("brandName", name);
ALTER TABLE public."Product" ALTER COLUMN "productIdentifier" SET NOT NULL, ALTER COLUMN "productName" SET NOT NULL, ALTER COLUMN "materialId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Product_productIdentifier_key" ON public."Product" ("productIdentifier");
ALTER TABLE public."ProductVariant" ALTER COLUMN "mountType" DROP DEFAULT;
ALTER TABLE public."ProductVariant" ALTER COLUMN "mountType" TYPE text USING "mountType"::text;
ALTER TABLE public."ProductVariant" ALTER COLUMN "mountType" SET DEFAULT 'NONE';
ALTER TABLE public."ProductVariant" ALTER COLUMN "productId" DROP NOT NULL;
-- Existing offerPrice is the selling price; retain the original list price as mrp.
UPDATE public."ProductVariant" SET mrp = price, price = coalesce("offerPrice", price) WHERE mrp IS NULL;
UPDATE public."ProductVariant" v SET color = coalesce(p."availableColors"[1], 'Standard') FROM public."Product" p WHERE v."productId" = p.id AND v.color IS NULL;
UPDATE public."ProductVariant" SET color = 'Standard' WHERE color IS NULL;
ALTER TABLE public."ProductVariant" ALTER COLUMN color SET NOT NULL, ALTER COLUMN mrp SET NOT NULL;
UPDATE public."Product" p SET "variantId" = (SELECT v.id FROM public."ProductVariant" v WHERE v."productId" = p.id ORDER BY v."createdAt", v.id LIMIT 1) WHERE p."variantId" IS NULL;
UPDATE public."ProductImage" i SET "productIdentifier" = p."productIdentifier" FROM public."Product" p WHERE i."productId" = p.id AND i."productIdentifier" IS NULL;
ALTER TABLE public."ProductImage" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE public."ProductImage" ALTER COLUMN "productIdentifier" SET NOT NULL;
UPDATE public."ProductImage" i SET "isPrimary" = true WHERE i.id IN (SELECT DISTINCT ON ("productIdentifier") id FROM public."ProductImage" x WHERE NOT EXISTS (SELECT 1 FROM public."ProductImage" y WHERE y."productIdentifier" = x."productIdentifier" AND y."isPrimary") ORDER BY "productIdentifier", "displayOrder", "createdAt", id);
ALTER TABLE public."ProductImage" ADD CONSTRAINT "ProductImage_identifier_backend_fkey" FOREIGN KEY ("productIdentifier") REFERENCES public."Product" ("productIdentifier") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public."Product" ADD CONSTRAINT "Product_material_backend_fkey" FOREIGN KEY ("materialId") REFERENCES public."Material" (id) ON DELETE RESTRICT;
ALTER TABLE public."Product" ADD CONSTRAINT "Product_primary_variant_backend_fkey" FOREIGN KEY ("variantId") REFERENCES public."ProductVariant" (id) ON DELETE RESTRICT;
