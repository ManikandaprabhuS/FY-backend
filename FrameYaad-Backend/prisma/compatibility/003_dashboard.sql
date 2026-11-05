-- Existing notification categories are preserved alongside current event categories.
CREATE TYPE public.notification_type AS ENUM ('ACCOUNT_CREATED', 'ORDER_PLACED', 'info', 'success');
ALTER TABLE public.notifications ALTER COLUMN type DROP DEFAULT;
ALTER TABLE public.notifications ALTER COLUMN type TYPE public.notification_type USING type::public.notification_type;
ALTER TABLE public.notifications ALTER COLUMN type SET DEFAULT 'info';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "userId" text REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "updatedAt" timestamp(3);
UPDATE public.notifications SET "updatedAt"=date WHERE "updatedAt" IS NULL;
ALTER TABLE public.notifications ALTER COLUMN "updatedAt" SET NOT NULL, ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE TYPE public.coupon_type AS ENUM ('PERCENTAGE','FLAT','LIMITED_COUNT','ORDER_PRICE_ABOVE','ONCE_PER_USER','NEW_USER','FESTIVAL','BUY_ONE_GET_ONE','BUY_TWO_GET_ONE');
CREATE TYPE public.coupon_discount_type AS ENUM ('PERCENTAGE','FLAT','NONE');
ALTER TABLE public.coupon ALTER COLUMN "couponType" TYPE public.coupon_type USING (CASE "couponType"::text WHEN 'PERCENT_OFFER' THEN 'PERCENTAGE' WHEN 'ONE_PER_USER' THEN 'ONCE_PER_USER' WHEN 'FESTIVE_DAYS' THEN 'FESTIVAL' WHEN 'BUY_1_GET_1' THEN 'BUY_ONE_GET_ONE' WHEN 'BUY_2_GET_1' THEN 'BUY_TWO_GET_ONE' ELSE "couponType"::text END)::public.coupon_type;
ALTER TABLE public.coupon ALTER COLUMN "discountType" TYPE public.coupon_discount_type USING (CASE "discountType"::text WHEN 'FLAT_OFFER' THEN 'FLAT' WHEN 'PERCENTAGE_OFFER' THEN 'PERCENTAGE' ELSE "discountType"::text END)::public.coupon_discount_type;
ALTER TABLE public.coupon ADD COLUMN IF NOT EXISTS "minimumOrderValue" numeric(12,2) NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "usageLimit" integer, ADD COLUMN IF NOT EXISTS "usagePerUser" integer,
 ADD COLUMN IF NOT EXISTS "usageCount" integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "newUserOnly" boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS "festivalCoupon" boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS "buyOneGetOne" boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS "buyTwoGetOne" boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true;
ALTER TABLE public.coupon ALTER COLUMN "couponType" SET NOT NULL, ALTER COLUMN "discountType" SET NOT NULL, ALTER COLUMN "discountValue" SET NOT NULL, ALTER COLUMN "startDate" SET NOT NULL, ALTER COLUMN "endDate" SET NOT NULL, ALTER COLUMN "expiresAt" SET NOT NULL;
ALTER TABLE public.product_discount ADD COLUMN IF NOT EXISTS "productVariantId" text REFERENCES public."ProductVariant"(id) ON DELETE CASCADE;
ALTER TABLE public.product_discount ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE public.product_discount ALTER COLUMN "productVariantId" SET NOT NULL, ALTER COLUMN "couponId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "product_discount_variant_coupon_key" ON public.product_discount ("productVariantId", "couponId");
ALTER TABLE public.wishlist ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
