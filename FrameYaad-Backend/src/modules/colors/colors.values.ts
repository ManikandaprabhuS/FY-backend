export const legacyColors = [
  { name: "Black", hex: "#0F172A" }, { name: "White", hex: "#FFFFFF" }, { name: "Natural Oak", hex: "#FEF3C7" },
  { name: "Dark Walnut", hex: "#4A3728" }, { name: "Silver", hex: "#94A3B8" }, { name: "Gold", hex: "#CA8A04" },
];
export const resolveLegacyColor = (value?: string | null) => {
  if (!value?.trim()) return { name: "-", hex: null };
  const color = legacyColors.find(item => item.hex.toLowerCase() === value.toLowerCase() || item.name.toLowerCase() === value.toLowerCase());
  return color ?? { name: /^#[a-f0-9]{6}$/i.test(value) ? "-" : value, hex: /^#[a-f0-9]{6}$/i.test(value) ? value : null };
};
