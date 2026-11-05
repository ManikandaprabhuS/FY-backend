import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app";

describe("health API", () => {
  it("returns service health", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    const body = response.body as {
      success: boolean;
      data: { status: string; timestamp: string };
    };

    expect(body).toMatchObject({
      success: true,
      data: { status: "ok" },
    });
    expect(body.data.timestamp).toEqual(expect.any(String));
  });

  it("returns the standard error envelope for unknown routes", async () => {
    const response = await request(app).get("/api/v1/unknown");

    expect(response.status).toBe(404);
    const body = response.body as {
      success: boolean;
      error: { code: string };
      requestId: string;
    };

    expect(body).toMatchObject({
      success: false,
      error: { code: "ROUTE_NOT_FOUND" },
    });
    expect(typeof body.requestId).toBe("string");
  });
});
