import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./prisma/client";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, "FrameYaad API started");
  console.log("Application is running on", env.PORT);
});

const shutdown = (signal: NodeJS.Signals): void => {
  logger.info({ signal }, "Shutting down FrameYaad API");
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
