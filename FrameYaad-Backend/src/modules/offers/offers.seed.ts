import { prisma } from "../../prisma/client";
import { OFFER_SEED_DEFAULTS } from "../checkout/coupons.config";
import type { Prisma } from "@prisma/client";
export const seedOffers=(db:Prisma.TransactionClient=prisma)=>db.offer.createMany({data:Object.values(OFFER_SEED_DEFAULTS),skipDuplicates:true});
