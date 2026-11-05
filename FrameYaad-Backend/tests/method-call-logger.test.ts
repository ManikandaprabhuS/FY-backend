import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("../src/config/logger", () => ({
  logger: { info: mocks.info },
}));

import {
  logMethodCall,
  methodCallMessage,
} from "../src/middleware/method-call-logger.middleware";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("API method-call logging", () => {
  it.each([
    ["POST", "/products", "Product Add method is calling"],
    ["PATCH", "/orders/order-id/status", "Order Status Update method is calling"],
    ["POST", "/auth/employee/login", "Employee Login method is calling"],
    ["DELETE", "/wishlist/item-id", "Wishlist Product Remove method is calling"],
    ["PATCH", "/notifications/notice-id/read", "Notification Mark Read method is calling"],
  ])("returns a meaningful label for %s %s", (method, path, expected) => {
    expect(methodCallMessage(method, path)).toBe(expected);
  });

  it("provides a useful fallback for future API methods", () => {
    expect(methodCallMessage("POST", "/future-module/action"))
      .toBe("POST /future-module/action API method is calling");
  });

  it("writes both structured and plain-text deployment logs", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = {
      method: "POST",
      path: "/products",
      requestId: "request-123",
    } as Request;
    const next = vi.fn() as NextFunction;

    logMethodCall(request, {} as Response, next);

    expect(mocks.info).toHaveBeenCalledWith(
      { requestId: "request-123", httpMethod: "POST", path: "/products" },
      "Product Add method is calling",
    );
    expect(consoleLog).toHaveBeenCalledWith("Product Add method is calling");
    expect(next).toHaveBeenCalledOnce();
  });
});
