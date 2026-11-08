import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../prisma/client";
import { authenticate, authorize } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import { ApiError } from "../../utils/api-error";

export const colorSchema = z.object({
  name: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9 ]+$/, "Colour name must contain only letters, numbers and spaces"),
  hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Enter a valid six-digit hex colour").transform(value => value.toUpperCase()),
}).strict();
import { legacyColors } from "./colors.values";
export const colorsRouter = Router();
colorsRouter.get("/", async (_request, response) => {
  const colors = await prisma.frameColor.findMany({ orderBy: [{ createdAt: "asc" }, { name: "asc" }], select: { id: true, name: true, hex: true } });
  response.json({ success: true, data: { colors, legacyColors } });
});
colorsRouter.post("/", authenticate, authorize(UserRole.ADMIN, UserRole.EMPLOYEE), validateBody(colorSchema), async (request, response) => {
  const input = colorSchema.parse(request.body);
  const normalizedName = input.name.toLowerCase();
  if (legacyColors.some(color => color.name.toLowerCase() === normalizedName || color.hex === input.hex)) throw new ApiError(409, "A colour with this name or hex already exists.", "DUPLICATE_RECORD");
  const duplicate = await prisma.frameColor.findFirst({ where: { OR: [{ normalizedName }, { hex: input.hex }] }, select: { id: true } });
  if (duplicate) throw new ApiError(409, "A colour with this name or hex already exists.", "DUPLICATE_RECORD");
  const color = await prisma.frameColor.create({ data: { ...input, normalizedName }, select: { id: true, name: true, hex: true } });
  response.status(201).json({ success: true, data: { color } });
});
