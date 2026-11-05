-- FrameYaad current-scope schema: authentication profiles and product catalog.
-- Supabase Auth remains the identity source; public.users stores application profile data.

CREATE TYPE "public"."user_role" AS ENUM ('CUSTOMER', 'EMPLOYEE', 'ADMIN');

CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_number" VARCHAR(20),
    "is_phone_number_verified" BOOLEAN NOT NULL DEFAULT false,
    "address_line" VARCHAR(255),
    "postal_code" VARCHAR(20),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "gender" VARCHAR(30),
    "role" "public"."user_role" NOT NULL DEFAULT 'CUSTOMER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_not_blank" CHECK (length(btrim("email")) > 0),
    CONSTRAINT "users_name_not_blank" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "public"."user_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "address_line" VARCHAR(255) NOT NULL,
    "postal_code" VARCHAR(20) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "country" VARCHAR(100) NOT NULL,
    "contact_person" VARCHAR(120) NOT NULL,
    "contact_number" VARCHAR(20) NOT NULL,
    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "brand_name" VARCHAR(120) NOT NULL,
    "material" VARCHAR(120) NOT NULL,
    "available_colors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "color" VARCHAR(80) NOT NULL,
    "frame_size" VARCHAR(80) NOT NULL,
    "mount_type" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "mrp" DECIMAL(12,2) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "variants_valid_prices" CHECK ("mrp" >= 0 AND "price" >= 0 AND "price" <= "mrp")
);

CREATE TABLE "public"."products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_identifier" VARCHAR(100) NOT NULL,
    "product_name" VARCHAR(160) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_identifier_not_blank" CHECK (length(btrim("product_identifier")) > 0),
    CONSTRAINT "products_name_not_blank" CHECK (length(btrim("product_name")) > 0)
);

CREATE TABLE "public"."product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_identifier" VARCHAR(100) NOT NULL,
    "image_url" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_images_url_not_blank" CHECK (length(btrim("image_url")) > 0)
);

CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");
CREATE UNIQUE INDEX "users_phone_number_key" ON "public"."users"("phone_number");
CREATE INDEX "users_created_by_idx" ON "public"."users"("created_by");
CREATE INDEX "users_role_is_active_idx" ON "public"."users"("role", "is_active");
CREATE INDEX "user_addresses_user_id_idx" ON "public"."user_addresses"("user_id");
CREATE INDEX "materials_created_by_idx" ON "public"."materials"("created_by");
CREATE INDEX "materials_is_active_idx" ON "public"."materials"("is_active");
CREATE UNIQUE INDEX "materials_brand_name_name_key" ON "public"."materials"("brand_name", "name");
CREATE INDEX "variants_created_by_idx" ON "public"."variants"("created_by");
CREATE INDEX "variants_is_active_idx" ON "public"."variants"("is_active");
CREATE UNIQUE INDEX "variants_color_frame_size_mount_type_mrp_price_key" ON "public"."variants"("color", "frame_size", "mount_type", "mrp", "price");
CREATE UNIQUE INDEX "products_product_identifier_key" ON "public"."products"("product_identifier");
CREATE INDEX "products_material_id_idx" ON "public"."products"("material_id");
CREATE INDEX "products_variant_id_idx" ON "public"."products"("variant_id");
CREATE INDEX "products_created_by_idx" ON "public"."products"("created_by");
CREATE INDEX "products_product_name_idx" ON "public"."products"("product_name");
CREATE INDEX "product_images_product_identifier_idx" ON "public"."product_images"("product_identifier");
CREATE UNIQUE INDEX "product_images_one_primary_per_product_key"
    ON "public"."product_images"("product_identifier") WHERE "is_primary" = true;

ALTER TABLE "public"."users"
    ADD CONSTRAINT "users_auth_user_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."user_addresses"
    ADD CONSTRAINT "user_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."materials"
    ADD CONSTRAINT "materials_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."variants"
    ADD CONSTRAINT "variants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."products"
    ADD CONSTRAINT "products_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "products_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."product_images"
    ADD CONSTRAINT "product_images_product_identifier_fkey" FOREIGN KEY ("product_identifier") REFERENCES "public"."products"("product_identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- Direct browser access is denied. The Express backend owns all business operations.
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;
