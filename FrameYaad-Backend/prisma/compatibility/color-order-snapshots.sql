-- Additive color catalogue and checkout snapshot support. No order rows are rewritten.
CREATE TABLE IF NOT EXISTS public.frame_colors (id TEXT PRIMARY KEY, name VARCHAR(30) NOT NULL, "normalizedName" VARCHAR(30) NOT NULL UNIQUE, hex VARCHAR(7) NOT NULL UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE public.frame_colors ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.frame_colors FROM anon, authenticated;
INSERT INTO public.frame_colors (id,name,"normalizedName",hex) VALUES (gen_random_uuid()::text,'Black','black','#000000'),(gen_random_uuid()::text,'White','white','#FFFFFF') ON CONFLICT DO NOTHING;
ALTER TABLE public."CartItem" ADD COLUMN IF NOT EXISTS "selectedVariantId" TEXT, ADD COLUMN IF NOT EXISTS "selectedColorName" TEXT, ADD COLUMN IF NOT EXISTS "selectedColorHex" TEXT, ADD COLUMN IF NOT EXISTS "selectionKey" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_cartId_productIdentifier_selectionKey_key" ON public."CartItem" ("cartId","productIdentifier","selectionKey");
ALTER TABLE public."CartItem" DROP CONSTRAINT IF EXISTS "CartItem_cartId_productIdentifier_key";
DROP INDEX IF EXISTS public."CartItem_cartId_productIdentifier_key";
ALTER TABLE public."OrderItem" ADD COLUMN IF NOT EXISTS "snapshotVariantId" TEXT, ADD COLUMN IF NOT EXISTS "snapshotColorName" TEXT, ADD COLUMN IF NOT EXISTS "snapshotColorHex" TEXT, ADD COLUMN IF NOT EXISTS "snapshotMaterial" TEXT;
