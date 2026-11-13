import { UserRole } from "@prisma/client";
import {getPhotoMaxBytes,PHOTO_MB_BYTES} from "../../utils/photo-limits";
import { prisma } from "../../prisma/client";
import { exportAmount, exportDate } from "../../utils/csv-export";
import { resolveLegacyColor } from "../colors/colors.values";
import { productListQuerySchema } from "./products.schemas";
import { buildProductWhere } from "./products.filters";

export const productExportHeaders = ["Product ID", "Name", "Brand", "Description", "Status", "Material", "Category", "Created date", "Base price", "Discount/offer", "Stock total", "Variant ID/SKU", "Size", "Frame colour", "Colour hex", "Price", "Selling price", "Stock quantity", "Variant status", "Max photo upload size (MB)"];
export async function* productExportRows(rawQuery: unknown) {
  const where = buildProductWhere(productListQuerySchema.parse(rawQuery), UserRole.ADMIN);
  const colors = await prisma.frameColor.findMany({ select: { name: true, hex: true } });
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.product.findMany({
      where, take: 250, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, productName: true, createdAt: true, material: { select: { name: true, material: true, brandName: true, description: true, isActive: true } }, variants: { select: { id: true, frameSize: true, color: true, mrp: true, price: true, stockQuantity: true, maxPhotoSizeMB:true, isActive: true }, orderBy: { createdAt: "asc" } } },
    });
    for (const product of batch) {
      const active = product.variants.filter(v => v.isActive);
      const base = active.length ? Math.min(...active.map(v => Number(v.price))) : null;
      const stock = product.variants.reduce((sum, v) => sum + v.stockQuantity, 0);
      for (const variant of product.variants.length ? product.variants : [null]) {
        const color = colors.find(c => c.hex.toLowerCase() === variant?.color?.toLowerCase() || c.name.toLowerCase() === variant?.color?.toLowerCase()) ?? resolveLegacyColor(variant?.color);
        const mrp = Number(variant?.mrp ?? 0), selling = Number(variant?.price ?? 0);
        const discount = variant && variant.isActive && mrp > selling && selling > 0 ? Math.round((mrp - selling) / mrp * 100) + "% OFF" : "-";
        yield [product.id, product.productName, product.material.brandName, product.material.description, product.material.isActive ? "Active" : "Draft", product.material.material || product.material.name, "-", exportDate(product.createdAt), base === null ? "-" : exportAmount(base), discount, stock, variant?.id ?? "", variant?.frameSize ?? "", variant ? color.name : "", variant ? color.hex ?? "" : "", variant ? exportAmount(variant.mrp ?? variant.price) : "", variant ? exportAmount(variant.price) : "", variant?.stockQuantity ?? "", variant ? variant.isActive ? "Active" : "Draft" : "", variant?Number((getPhotoMaxBytes([variant])/PHOTO_MB_BYTES).toFixed(1)):""];
      }
    }
    if (batch.length < 250) break;
    cursor = batch[batch.length - 1]!.id;
  }
}
