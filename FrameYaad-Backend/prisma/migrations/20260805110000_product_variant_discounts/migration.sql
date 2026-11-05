CREATE TABLE "product_discounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_variant_id" UUID NOT NULL,
  "coupon_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_discounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_discounts_product_variant_id_coupon_id_key" UNIQUE ("product_variant_id", "coupon_id"),
  CONSTRAINT "product_discounts_variant_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_discounts_coupon_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "product_discounts_product_variant_id_idx" ON "product_discounts"("product_variant_id");
CREATE INDEX "product_discounts_coupon_id_idx" ON "product_discounts"("coupon_id");
