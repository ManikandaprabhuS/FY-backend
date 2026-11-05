-- Keep order IDs, totals, statuses and shipping snapshots intact.
ALTER TYPE public."OrderStatus" ADD VALUE IF NOT EXISTS 'READY_TO_SHIP';
INSERT INTO public.user_address (id, "userId", "addressLine", "postCode", city, state, country, "contactPerson", "contactNumber", "createdAt", "updatedAt")
SELECT o.id, o."userId", o."addressLine", o."postalCode", o."cityName", o."stateName", o."countryName", u.name, o."phoneNumber", o."createdAt", o."updatedAt"
FROM public."Order" o JOIN public.users u ON u.id=o."userId"
WHERE o."userAddressId" IS NULL AND NOT EXISTS (SELECT 1 FROM public.user_address a WHERE a.id=o.id);
UPDATE public."Order" SET "userAddressId"=id WHERE "userAddressId" IS NULL;
UPDATE public.user_address a SET "postCode"=coalesce(a."postCode", ''), "contactPerson"=coalesce(a."contactPerson", u.name), "contactNumber"=coalesce(a."contactNumber", u."phoneNumber", '') FROM public.users u WHERE u.id=a."userId";
ALTER TABLE public.user_address ALTER COLUMN "postCode" SET NOT NULL, ALTER COLUMN "contactPerson" SET NOT NULL, ALTER COLUMN "contactNumber" SET NOT NULL;
UPDATE public."Order" SET "orderNumber"='FY-' || upper(replace(id,'-','')) WHERE "orderNumber" IS NULL;
ALTER TABLE public."Order" ALTER COLUMN "userAddressId" SET NOT NULL, ALTER COLUMN "orderNumber" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderNumber_key" ON public."Order" ("orderNumber");
ALTER TABLE public."Order" ALTER COLUMN "phoneNumber" DROP NOT NULL, ALTER COLUMN "addressLine" DROP NOT NULL, ALTER COLUMN "cityName" DROP NOT NULL, ALTER COLUMN "stateName" DROP NOT NULL, ALTER COLUMN "countryName" DROP NOT NULL, ALTER COLUMN "postalCode" DROP NOT NULL;
UPDATE public."OrderItem" i SET "productIdentifier"=p."productIdentifier" FROM public."Product" p WHERE p.id=i."productId" AND i."productIdentifier" IS NULL;
-- Deleted products keep their original productName/frameSize snapshots; do not recreate catalog products.
ALTER TABLE public."OrderItem" ALTER COLUMN "productName" DROP NOT NULL, ALTER COLUMN "frameSize" DROP NOT NULL;
ALTER TABLE public."OrderItem" ADD CONSTRAINT "OrderItem_identifier_backend_fkey" FOREIGN KEY ("productIdentifier") REFERENCES public."Product" ("productIdentifier") ON UPDATE CASCADE ON DELETE RESTRICT;
UPDATE public."Cart" SET "totalPrice"=0 WHERE "totalPrice" IS NULL;
ALTER TABLE public."Cart" ALTER COLUMN "totalPrice" SET DEFAULT 0, ALTER COLUMN "totalPrice" SET NOT NULL;
UPDATE public."CartItem" i SET "productIdentifier"=p."productIdentifier", price=coalesce(i.price,v.price), subtotal=coalesce(i.subtotal,coalesce(i.price,v.price)*i.quantity) FROM public."ProductVariant" v JOIN public."Product" p ON p.id=v."productId" WHERE v.id=i."variantId" AND i."productIdentifier" IS NULL;
ALTER TABLE public."CartItem" ALTER COLUMN "variantId" DROP NOT NULL;
ALTER TABLE public."CartItem" ALTER COLUMN "productIdentifier" SET NOT NULL, ALTER COLUMN price SET NOT NULL, ALTER COLUMN subtotal SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_cartId_identifier_key" ON public."CartItem" ("cartId", "productIdentifier");
UPDATE public.wishlist w SET "productIdentifier"=p."productIdentifier" FROM public."Product" p WHERE p.id=w."productId" AND w."productIdentifier" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "wishlist_userId_identifier_key" ON public.wishlist ("userId", "productIdentifier");
