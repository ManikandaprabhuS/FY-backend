import pino from "pino";

import { env } from "./env";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "password",
      "token",
      "access_token",
      "refresh_token",
      "req.body.access_token",
      "req.body.refresh_token",
    ],
    censor: "[REDACTED]",
  },
});
