import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../prisma/client";
import { paginationMeta } from "../../utils/pagination";
import { productViewSelect } from "./products.select";

const stringList = z.preprocess(value => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}, z.array(z.string().trim().min(1).max(120)).max(30).default([]));
export const publicCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  materialId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  materials: stringList,
  frameSizes: stringList,
  availability: z.enum(["all", "in-stock", "out-of-stock"]).default("all"),
  maxPrice: z.coerce.number().finite().nonnegative().optional(),
  saleOnly: z.enum(["true", "false"]).default("false"),
  sort: z.enum(["featured", "newest", "price-low", "price-high", "name"]).default("featured"),
});
type Facet = { value: string; count: number };
export interface CatalogFacets { materials: Facet[]; sizes: Facet[]; onSale: number; inStock: number; outOfStock: number; maximumPrice: number }

export const listPublicCatalog = async (rawQuery: unknown) => {
  const query = publicCatalogQuerySchema.parse(rawQuery);
  const filters: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (query.search) filters.push(Prisma.sql`("productName" ILIKE ${`%${query.search}%`} OR "productIdentifier" ILIKE ${`%${query.search}%`})`);
  if (query.materialId) filters.push(Prisma.sql`"materialId" = ${query.materialId}`);
  if (query.variantId) filters.push(Prisma.sql`"variantId" = ${query.variantId}`);
  if (query.materials.length) filters.push(Prisma.sql`material IN (${Prisma.join(query.materials)})`);
  if (query.frameSizes.length) filters.push(Prisma.sql`sizes && ARRAY[${Prisma.join(query.frameSizes)}]::text[]`);
  if (query.availability === "in-stock") filters.push(Prisma.sql`stock > 0`);
  if (query.availability === "out-of-stock") filters.push(Prisma.sql`stock <= 0`);
  if (query.maxPrice !== undefined) filters.push(Prisma.sql`price <= ${query.maxPrice}`);
  if (query.saleOnly === "true") filters.push(Prisma.sql`mrp > price`);
  const sorting: Record<typeof query.sort, Prisma.Sql> = {
    featured: Prisma.sql`"createdAt" DESC, id ASC`, newest: Prisma.sql`"createdAt" DESC, id ASC`,
    "price-low": Prisma.sql`price ASC, "createdAt" DESC, id ASC`,
    "price-high": Prisma.sql`price DESC, "createdAt" DESC, id ASC`,
    name: Prisma.sql`"productName" ASC, id ASC`,
  };
  const rows = await prisma.$queryRaw<Array<{ ids: string[]; total: number; facets: CatalogFacets }>>(Prisma.sql`
    WITH catalog AS (
      SELECT p.id, p."productName", p."productIdentifier", p."materialId", p."variantId", p."createdAt", m.material,
        COALESCE(SUM(v."stockQuantity"), 0) AS stock,
        COALESCE(MIN(v.price), 0) AS price,
        (ARRAY_AGG(v.mrp ORDER BY v.price, v."createdAt", v.id))[1] AS mrp,
        ARRAY_AGG(DISTINCT v."frameSize") FILTER (WHERE v.id IS NOT NULL) AS sizes
      FROM public."Product" p
      JOIN public."Material" m ON m.id = p."materialId" AND m."isActive" = true
      JOIN public."ProductVariant" primary_variant ON primary_variant.id = p."variantId" AND primary_variant."isActive" = true
      LEFT JOIN public."ProductVariant" v ON v."productId" = p.id AND v."isActive" = true
      GROUP BY p.id, m.material
    ), filtered AS (SELECT * FROM catalog WHERE ${Prisma.join(filters, " AND ")}),
    paged AS (SELECT id FROM filtered ORDER BY ${sorting[query.sort]} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit})
    SELECT COALESCE((SELECT ARRAY_AGG(id) FROM paged), ARRAY[]::text[]) AS ids,
      (SELECT COUNT(*)::int FROM filtered) AS total,
      JSON_BUILD_OBJECT(
        'materials', COALESCE((SELECT JSON_AGG(f) FROM (SELECT material AS value, COUNT(*)::int AS count FROM catalog GROUP BY material ORDER BY material) f), '[]'::json),
        'sizes', COALESCE((SELECT JSON_AGG(f) FROM (SELECT size AS value, COUNT(*)::int AS count FROM catalog CROSS JOIN LATERAL UNNEST(sizes) size GROUP BY size ORDER BY size) f), '[]'::json),
        'onSale', (SELECT COUNT(*)::int FROM catalog WHERE mrp > price),
        'inStock', (SELECT COUNT(*)::int FROM catalog WHERE stock > 0),
        'outOfStock', (SELECT COUNT(*)::int FROM catalog WHERE stock <= 0),
        'maximumPrice', (SELECT COALESCE(MAX(price), 0) FROM catalog)
      ) AS facets
  `);
  const result = rows[0]!;
  const products = result.ids.length ? await prisma.product.findMany({ where: { id: { in: result.ids } }, select: productViewSelect }) : [];
  const byId = new Map(products.map(product => [product.id, product]));
  return {
    products: result.ids.flatMap(id => { const product = byId.get(id); return product ? [{ ...product, variants: product.variants.filter(variant => variant.isActive) }] : []; }),
    pagination: paginationMeta(query.page, query.limit, result.total), facets: result.facets,
  };
};
