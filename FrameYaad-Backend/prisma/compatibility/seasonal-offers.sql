-- Extend only the existing fixed-code checks while preserving prices, rows, RLS and other checks.
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_code_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_code_check CHECK (code IN ('FIRST_ORDER','BIG_ORDER','NEW_YEAR','CHRISTMAS','PONGAL'));
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_check CHECK ((code='FIRST_ORDER' AND "minOrderAmount" IS NULL) OR (code IN ('BIG_ORDER','NEW_YEAR','CHRISTMAS','PONGAL') AND "minOrderAmount">0));
ALTER TABLE IF EXISTS public.homepage_banner DROP CONSTRAINT IF EXISTS "homepage_banner_featuredOfferCode_check";
ALTER TABLE IF EXISTS public.homepage_banner ADD CONSTRAINT "homepage_banner_featuredOfferCode_check" CHECK ("featuredOfferCode" IN ('FIRST_ORDER','BIG_ORDER','NEW_YEAR','CHRISTMAS','PONGAL'));
