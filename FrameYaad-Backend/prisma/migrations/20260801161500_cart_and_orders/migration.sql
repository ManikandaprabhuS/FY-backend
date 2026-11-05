CREATE TYPE "public"."order_status" AS ENUM (
    'PLACED',
    'CONFIRMED',
    'PROCESSING',
    'READY_TO_SHIP',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED'
);

CREATE TABLE "public"."carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT "carts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "carts_total_price_nonnegative" CHECK ("total_price" >= 0)
);

CREATE TABLE "public"."cart_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "product_identifier" VARCHAR(100) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cart_items_positive_values" CHECK ("quantity" > 0 AND "price" >= 0 AND "subtotal" >= 0),
    CONSTRAINT "cart_items_subtotal_matches" CHECK ("subtotal" = "price" * "quantity")
);

CREATE TABLE "public"."orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "order_number" VARCHAR(40) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "order_status" "public"."order_status" NOT NULL DEFAULT 'PLACED',
    "user_address_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remark" TEXT,
    "coupon_id" UUID,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_total_price_nonnegative" CHECK ("total_price" >= 0)
);

CREATE TABLE "public"."order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_identifier" VARCHAR(100) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_items_positive_values" CHECK ("quantity" > 0 AND "price" >= 0 AND "subtotal" >= 0),
    CONSTRAINT "order_items_subtotal_matches" CHECK ("subtotal" = "price" * "quantity")
);

CREATE UNIQUE INDEX "carts_user_id_key" ON "public"."carts"("user_id");
CREATE UNIQUE INDEX "cart_items_cart_id_product_identifier_key" ON "public"."cart_items"("cart_id", "product_identifier");
CREATE INDEX "cart_items_product_identifier_idx" ON "public"."cart_items"("product_identifier");
CREATE UNIQUE INDEX "orders_order_number_key" ON "public"."orders"("order_number");
CREATE INDEX "orders_user_id_created_at_idx" ON "public"."orders"("user_id", "created_at");
CREATE INDEX "orders_order_status_created_at_idx" ON "public"."orders"("order_status", "created_at");
CREATE INDEX "orders_user_address_id_idx" ON "public"."orders"("user_address_id");
CREATE INDEX "order_items_order_id_idx" ON "public"."order_items"("order_id");
CREATE INDEX "order_items_product_identifier_idx" ON "public"."order_items"("product_identifier");

ALTER TABLE "public"."carts"
    ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."cart_items"
    ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "cart_items_product_identifier_fkey" FOREIGN KEY ("product_identifier") REFERENCES "public"."products"("product_identifier") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "orders_user_address_id_fkey" FOREIGN KEY ("user_address_id") REFERENCES "public"."user_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "order_items_product_identifier_fkey" FOREIGN KEY ("product_identifier") REFERENCES "public"."products"("product_identifier") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cart_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;
