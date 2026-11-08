import { prisma } from "../../prisma/client";
import { legacyColors } from "./colors.values";
export async function resolveFrameColor(value?: string | null) {
  if (!value?.trim()) return { name: null, hex: null };
  const trimmed = value.trim();
  const known = await prisma.frameColor.findFirst({ where: { OR: [{ normalizedName: trimmed.toLowerCase() }, { hex: trimmed.toUpperCase() }] }, select: { name: true, hex: true } });
  if (known) return known;
  const legacy = legacyColors.find(color => color.hex === trimmed.toUpperCase() || color.name.toLowerCase() === trimmed.toLowerCase());
  if (legacy) return legacy;
  return /^#[a-f0-9]{6}$/i.test(trimmed) ? { name: trimmed.toUpperCase(), hex: trimmed.toUpperCase() } : { name: trimmed, hex: null };
}
