-- Review-only additive deployment. Existing products/users/orders are not changed.
CREATE TABLE IF NOT EXISTS public.reviews (
 id TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES public."Product"(id) ON DELETE CASCADE,
 "userId" TEXT REFERENCES public.users(id) ON DELETE SET NULL, name VARCHAR(50) NOT NULL,
 email VARCHAR(254) NOT NULL CHECK (email = lower(btrim(email))), rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
 title VARCHAR(100), comment VARCHAR(1000) NOT NULL CHECK (length(btrim(comment)) BETWEEN 10 AND 1000),
 status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
 "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedBy" TEXT REFERENCES public.users(id) ON DELETE SET NULL,
 "reviewedAt" TIMESTAMP(3), "rejectionReason" VARCHAR(500), "requestIpHash" VARCHAR(64) NOT NULL,
 "commentHash" VARCHAR(64) NOT NULL, "notificationId" TEXT UNIQUE, "effectsProcessedAt" TIMESTAMP(3),
 CONSTRAINT reviews_productId_email_key UNIQUE ("productId",email),
 CHECK (length(btrim(name)) BETWEEN 2 AND 50)
);
CREATE INDEX IF NOT EXISTS "reviews_productId_status_createdAt_idx" ON public.reviews ("productId",status,"createdAt" DESC);
CREATE INDEX IF NOT EXISTS "reviews_status_createdAt_idx" ON public.reviews (status,"createdAt" DESC);
CREATE INDEX IF NOT EXISTS "reviews_createdAt_idx" ON public.reviews ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "reviews_requestIpHash_createdAt_idx" ON public.reviews ("requestIpHash","createdAt");
CREATE INDEX IF NOT EXISTS "reviews_email_createdAt_idx" ON public.reviews (email,"createdAt");
CREATE INDEX IF NOT EXISTS "reviews_commentHash_createdAt_idx" ON public.reviews ("commentHash","createdAt");
CREATE INDEX IF NOT EXISTS "reviews_effectsProcessedAt_createdAt_idx" ON public.reviews ("effectsProcessedAt","createdAt");
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reviews FROM anon, authenticated;
