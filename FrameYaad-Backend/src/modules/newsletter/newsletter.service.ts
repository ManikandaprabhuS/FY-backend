import { Prisma } from "@prisma/client";

import { logger } from "../../config/logger";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { paginationMeta } from "../../utils/pagination";
import {
  newsletterExportQuerySchema,
  newsletterListQuerySchema,
  type NewsletterEmailInput,
  type NewsletterListQuery,
} from "./newsletter.schemas";

const subscriberSelect = {
  id: true,
  email: true,
  isActive: true,
  subscribedAt: true,
  unsubscribedAt: true,
  createdAt: true,
} satisfies Prisma.NewsletterSubscriberSelect;

const subscriberView = <T extends {
  id: string;
  email: string;
  isActive: boolean;
  subscribedAt: Date;
  unsubscribedAt: Date | null;
  createdAt: Date;
}>(subscriber: T) => ({
  id: subscriber.id,
  email: subscriber.email,
  status: subscriber.isActive ? "ACTIVE" as const : "UNSUBSCRIBED" as const,
  subscribedAt: subscriber.subscribedAt,
  unsubscribedAt: subscriber.unsubscribedAt,
  createdAt: subscriber.createdAt,
});

const alreadySubscribed = () =>
  new ApiError(409, "This email is already subscribed to our newsletter", "ALREADY_SUBSCRIBED");

export const subscribe = async (input: NewsletterEmailInput) => {
  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: input.email },
    select: { id: true, isActive: true },
  });

  if (existing?.isActive) throw alreadySubscribed();

  const now = new Date();
  if (existing) {
    await prisma.newsletterSubscriber.update({
      where: { id: existing.id },
      data: { isActive: true, subscribedAt: now, unsubscribedAt: null },
    });
    logger.info({ subscriberId: existing.id }, "Newsletter subscriber reactivated");
    return { resubscribed: true };
  }

  try {
    const created = await prisma.newsletterSubscriber.create({
      data: {
        email: input.email,
        isActive: true,
        subscribedAt: now,
        unsubscribedAt: null,
      },
      select: { id: true },
    });
    logger.info({ subscriberId: created.id }, "Newsletter subscriber created");
    return { resubscribed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw alreadySubscribed();
    }
    throw error;
  }
};

export const unsubscribe = async (input: NewsletterEmailInput) => {
  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: input.email },
    select: { id: true, isActive: true },
  });

  if (!existing) {
    throw new ApiError(404, "This email is not subscribed to our newsletter", "SUBSCRIPTION_NOT_FOUND");
  }
  if (!existing.isActive) return { alreadyUnsubscribed: true };

  await prisma.newsletterSubscriber.update({
    where: { id: existing.id },
    data: { isActive: false, unsubscribedAt: new Date() },
  });
  logger.info({ subscriberId: existing.id }, "Newsletter subscriber deactivated");
  return { alreadyUnsubscribed: false };
};

const whereFrom = (query: Pick<NewsletterListQuery, "search" | "status">): Prisma.NewsletterSubscriberWhereInput => ({
  ...(query.search ? { email: { contains: query.search.toLowerCase(), mode: "insensitive" } } : {}),
  ...(query.status ? { isActive: query.status === "ACTIVE" } : {}),
});

export const listSubscribers = async (rawQuery: unknown) => {
  const query = newsletterListQuerySchema.parse(rawQuery);
  const where = whereFrom(query);
  const [subscribers, filteredTotal, total, active] = await prisma.$transaction([
    prisma.newsletterSubscriber.findMany({
      where,
      select: subscriberSelect,
      orderBy: { subscribedAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.newsletterSubscriber.count({ where }),
    prisma.newsletterSubscriber.count(),
    prisma.newsletterSubscriber.count({ where: { isActive: true } }),
  ]);

  return {
    subscribers: subscribers.map(subscriberView),
    summary: { total, active, unsubscribed: total - active },
    pagination: paginationMeta(query.page, query.limit, filteredTotal),
  };
};

const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const csvDate = (value: Date | null): string => value ? value.toISOString() : "";

export const exportSubscribers = async (rawQuery: unknown): Promise<string> => {
  const query = newsletterExportQuerySchema.parse(rawQuery);
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: whereFrom(query),
    select: subscriberSelect,
    orderBy: { subscribedAt: "desc" },
  });
  const rows = subscribers.map((subscriber) => [
    subscriber.email,
    subscriber.isActive ? "ACTIVE" : "UNSUBSCRIBED",
    csvDate(subscriber.subscribedAt),
    csvDate(subscriber.unsubscribedAt),
  ].map(csvCell).join(","));
  return ["Email,Status,Subscribed At,Unsubscribed At", ...rows].join("\r\n");
};

