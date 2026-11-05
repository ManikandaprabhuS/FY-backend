CREATE TYPE "coupon_type" AS ENUM ('PERCENTAGE', 'FLAT', 'LIMITED_COUNT', 'ORDER_PRICE_ABOVE', 'ONCE_PER_USER', 'NEW_USER', 'FESTIVAL', 'BUY_ONE_GET_ONE', 'BUY_TWO_GET_ONE');
CREATE TYPE "coupon_discount_type" AS ENUM ('PERCENTAGE', 'FLAT', 'NONE');
CREATE TABLE "coupons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "code" VARCHAR(40) NOT NULL, "description" TEXT,
  "coupon_type" "coupon_type" NOT NULL, "discount_type" "coupon_discount_type" NOT NULL,
  "discount_value" DECIMAL(12,2) NOT NULL, "minimum_order_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "usage_limit" INTEGER, "usage_per_user" INTEGER, "usage_count" INTEGER NOT NULL DEFAULT 0,
  "new_user_only" BOOLEAN NOT NULL DEFAULT false, "festival_coupon" BOOLEAN NOT NULL DEFAULT false,
  "buy_one_get_one" BOOLEAN NOT NULL DEFAULT false, "buy_two_get_one" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "start_date" TIMESTAMPTZ(6) NOT NULL,
  "end_date" TIMESTAMPTZ(6) NOT NULL, "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by" UUID, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id"), CONSTRAINT "coupons_code_key" UNIQUE ("code"),
  CONSTRAINT "coupons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "coupons_valid_dates" CHECK ("end_date" >= "start_date" AND "expires_at" >= "start_date"),
  CONSTRAINT "coupons_non_negative" CHECK ("discount_value" >= 0 AND "minimum_order_value" >= 0 AND ("usage_limit" IS NULL OR "usage_limit" >= 0) AND ("usage_per_user" IS NULL OR "usage_per_user" >= 0)),
  CONSTRAINT "coupons_usage_rule" CHECK ("usage_limit" IS NULL OR "usage_per_user" IS NULL OR "usage_per_user" <= "usage_limit"),
  CONSTRAINT "coupons_percentage_rule" CHECK ("discount_type" <> 'PERCENTAGE' OR "discount_value" <= 100)
);
CREATE INDEX "coupons_active_dates_idx" ON "coupons" ("is_active", "start_date", "end_date");
CREATE INDEX "coupons_coupon_type_idx" ON "coupons" ("coupon_type");
