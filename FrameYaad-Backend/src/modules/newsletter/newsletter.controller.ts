import type { RequestHandler } from "express";
import type { z } from "zod";

import type { newsletterEmailSchema } from "./newsletter.schemas";
import * as service from "./newsletter.service";

type EmailBody = z.infer<typeof newsletterEmailSchema>;

export const subscribe: RequestHandler = async (request, response) => {
  const result = await service.subscribe(request.body as EmailBody);
  response.status(result.resubscribed ? 200 : 201).json({
    success: true,
    message: result.resubscribed
      ? "Successfully resubscribed to our newsletter"
      : "Successfully subscribed to our newsletter",
    data: { resubscribed: result.resubscribed },
  });
};

export const unsubscribe: RequestHandler = async (request, response) => {
  const result = await service.unsubscribe(request.body as EmailBody);
  response.status(200).json({
    success: true,
    message: result.alreadyUnsubscribed
      ? "This email is already unsubscribed from our newsletter"
      : "Successfully unsubscribed from our newsletter",
  });
};

export const list: RequestHandler = async (request, response) => {
  response.status(200).json({ success: true, data: await service.listSubscribers(request.query) });
};

export const exportCsv: RequestHandler = async (request, response) => {
  const csv = await service.exportSubscribers(request.query);
  response
    .status(200)
    .setHeader("Content-Type", "text/csv; charset=utf-8")
    .setHeader("Content-Disposition", 'attachment; filename="frameyaad-newsletter-subscribers.csv"')
    .send(`\ufeff${csv}`);
};

