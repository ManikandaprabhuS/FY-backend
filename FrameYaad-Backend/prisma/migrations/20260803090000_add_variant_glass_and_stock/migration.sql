CREATE TYPE "public"."glass_type" AS ENUM ('NONE', 'OPTION_1', 'OPTION_2');

ALTER TABLE "public"."variants"
  ADD COLUMN "glass_type" "public"."glass_type" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "stock_quantity" INTEGER NOT NULL DEFAULT 0;
