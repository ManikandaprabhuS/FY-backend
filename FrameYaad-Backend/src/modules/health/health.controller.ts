import type { RequestHandler } from "express";

export const getHealth: RequestHandler = (_request, response) => {
  response.status(200).json({
    success: true,
    data: {
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
};
