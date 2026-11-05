import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { env } from "../src/config/env";
import { errorHandler } from "../src/middleware/error.middleware";
import { staffLoginRateLimit } from "../src/middleware/staff-login-rate-limit.middleware";

describe("staff login rate limiting", () => {
  it("blocks attempts above the configured limit and returns retry metadata", async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.post("/auth/staff/login", staffLoginRateLimit, (_request, response) => {
      response.status(401).json({ success: false });
    });
    testApp.use(errorHandler);

    const credentials = {
      email: `rate-limit-${Date.now()}@example.com`,
      password: "IncorrectPassword1",
    };

    for (let attempt = 0; attempt < env.STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const response = await request(testApp).post("/auth/staff/login").send(credentials);
      expect(response.status).toBe(401);
    }

    const blockedResponse = await request(testApp).post("/auth/staff/login").send(credentials);

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.headers["retry-after"]).toBeDefined();
    expect(blockedResponse.headers["ratelimit-limit"]).toBe(
      String(env.STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS),
    );
    expect(blockedResponse.body).toMatchObject({
      success: false,
      error: {
        code: "LOGIN_RATE_LIMIT_EXCEEDED",
        message: "Too many login attempts. Please try again later",
      },
    });
  });
});

