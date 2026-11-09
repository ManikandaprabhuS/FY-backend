import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ApiError } from "../../utils/api-error";

type WishlistRow = { id: string | null; userId: string; productIdentifier: string; createdAt: Date; alreadySaved: boolean; wishlistCount: number; product: Prisma.JsonObject };
type WishlistDb = Pick<Prisma.TransactionClient, "$queryRaw">;
export async function insertWishlist(db: WishlistDb, userId: string, productIdentifier: string) {
  // A single snapshot supplies the active-product check, conflict-safe insert,
  // complete card payload and count. No whole-wishlist read or per-item loop.
  for (let attempt = 0; attempt < 2; attempt++) {
    const rows = await db.$queryRaw<WishlistRow[]>(Prisma.sql`
      WITH eligible AS (
        SELECT p.id, p."materialId", p."variantId", p."productIdentifier", p."productName",
          p."createdBy", p."createdAt", p."updatedAt",
          m.id AS material_id, m.name AS material_name, m.description, m."brandName",
          m.material, m."availableColors", m."isActive" AS material_active, pv."isActive" AS variant_active
        FROM public."Product" p
        JOIN public."Material" m ON m.id = p."materialId" AND m."isActive" = true
        JOIN public."ProductVariant" pv ON pv.id = p."variantId" AND pv."isActive" = true
        WHERE p."productIdentifier" = ${productIdentifier}
      ), inserted AS (
        INSERT INTO public.wishlist (id, "userId", "productIdentifier", "createdAt")
        SELECT ${randomUUID()}, ${userId}, e."productIdentifier", CURRENT_TIMESTAMP FROM eligible e
        ON CONFLICT ("userId", "productIdentifier") DO NOTHING
        RETURNING id, "userId", "productIdentifier", "createdAt"
      ), chosen AS (
        SELECT i.*, false AS "alreadySaved" FROM inserted i
        UNION ALL
        SELECT w.id, w."userId", w."productIdentifier", w."createdAt", true AS "alreadySaved"
        FROM public.wishlist w JOIN eligible e ON e."productIdentifier" = w."productIdentifier"
        WHERE w."userId" = ${userId} AND NOT EXISTS (SELECT 1 FROM inserted)
      )
      SELECT c.id, c."userId", e."productIdentifier", c."createdAt", c."alreadySaved",
        ((SELECT COUNT(*) FROM public.wishlist WHERE "userId" = ${userId}) + (SELECT COUNT(*) FROM inserted))::int AS "wishlistCount",
        jsonb_build_object(
          'id', e.id, 'productIdentifier', e."productIdentifier", 'productName', e."productName",
          'materialId', e."materialId", 'variantId', e."variantId", 'createdById', e."createdBy",
          'createdAt', to_char(e."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedAt', to_char(e."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'material', jsonb_build_object('id', e.material_id, 'name', e.material_name, 'description', e.description,
            'brandName', e."brandName", 'material', e.material, 'availableColors', e."availableColors", 'isActive', e.material_active),
          'variant', jsonb_build_object('id', e."variantId", 'isActive', e.variant_active),
          'variants', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'color', v.color, 'frameSize', v."frameSize", 'imageUrl', v."imageUrl",
            'mountType', v."mountType", 'glassType', v."glassType", 'stockQuantity', v."stockQuantity",
            'mrp', v.mrp::text, 'price', v.price::text, 'isActive', v."isActive"
          ) ORDER BY v."createdAt") FROM public."ProductVariant" v WHERE v."productId" = e.id), '[]'::jsonb),
          'images', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', image.id, 'imageUrl', image."imageUrl", 'isPrimary', image."isPrimary",
            'color', image.color, 'createdAt', to_char(image."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) ORDER BY image."isPrimary" DESC, image."createdAt") FROM public."ProductImage" image WHERE image."productIdentifier" = e."productIdentifier"), '[]'::jsonb)
        ) AS product
      FROM eligible e LEFT JOIN chosen c ON c."productIdentifier" = e."productIdentifier"
    `);
    const row = rows[0];
    if (!row) throw new ApiError(404, "An active product was not found", "PRODUCT_NOT_FOUND");
    // ON CONFLICT can wait for a concurrent insert not visible to this statement's
    // snapshot. A fresh statement sees it; the unique key still prevents duplicates.
    if (!row.id) continue;
    return { wishlistItem: { id: row.id, userId: row.userId, productIdentifier: row.productIdentifier, createdAt: row.createdAt, product: row.product },
      wishlistCount: row.wishlistCount, alreadySaved: row.alreadySaved };
  }
  throw new ApiError(409, "Wishlist is being updated. Please try again.", "WISHLIST_UPDATE_CONFLICT");
}
