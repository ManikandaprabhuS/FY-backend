ALTER TABLE "public"."variants" ADD COLUMN "product_id" UUID;
ALTER TABLE "public"."products" ALTER COLUMN "variant_id" DROP NOT NULL;

WITH canonical AS (
  SELECT DISTINCT ON ("variant_id") "variant_id", "id" AS "product_id"
  FROM "public"."products"
  ORDER BY "variant_id", "id"
)
UPDATE "public"."variants" AS variant
SET "product_id" = canonical."product_id"
FROM canonical
WHERE variant."id" = canonical."variant_id";

WITH canonical AS (
  SELECT DISTINCT ON ("variant_id") "variant_id", "id" AS "product_id"
  FROM "public"."products"
  ORDER BY "variant_id", "id"
)
INSERT INTO "public"."variants" ("color", "frame_size", "mount_type", "glass_type", "stock_quantity", "is_active", "created_at", "updated_at", "created_by", "mrp", "price", "product_id")
SELECT variant."color", variant."frame_size", variant."mount_type", variant."glass_type", variant."stock_quantity", variant."is_active", variant."created_at", variant."updated_at", variant."created_by", variant."mrp", variant."price", product."id"
FROM "public"."products" AS product
JOIN canonical ON canonical."variant_id" = product."variant_id"
JOIN "public"."variants" AS variant ON variant."id" = canonical."variant_id"
WHERE product."id" <> canonical."product_id";

ALTER TABLE "public"."variants" ADD CONSTRAINT "variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "variants_product_id_idx" ON "public"."variants"("product_id");

ALTER TABLE "public"."variants" DROP CONSTRAINT "variants_color_frame_size_mount_type_mrp_price_key";
ALTER TABLE "public"."variants" ADD CONSTRAINT "variants_product_variant_values_key" UNIQUE ("product_id", "color", "frame_size", "mount_type", "glass_type", "mrp", "price");
