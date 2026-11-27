BEGIN;
ALTER TABLE public."Product"
 ADD COLUMN allow_customer_photo boolean NOT NULL DEFAULT true,
 ADD COLUMN max_photo_mb numeric(3,1) DEFAULT 4,
 ADD COLUMN is_frameyaad_art boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT product_photo_policy_check CHECK (
  (allow_customer_photo AND max_photo_mb IS NOT NULL AND max_photo_mb BETWEEN 1 AND 10)
  OR (NOT allow_customer_photo AND max_photo_mb IS NULL)
 );
CREATE INDEX product_arts_created_idx ON public."Product"(is_frameyaad_art,"createdAt" DESC);
-- Historical orders retain the old optional-photo presentation.
ALTER TABLE public."Order" ADD COLUMN customer_photo_allowed boolean NOT NULL DEFAULT true;
COMMIT;
