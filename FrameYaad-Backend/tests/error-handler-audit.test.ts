import express from "express";
import request from "supertest";
import { MulterError } from "multer";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../src/middleware/error.middleware";
import { ApiError } from "../src/utils/api-error";

const app = express();
app.use(express.json({ limit: "1kb" }));
app.post("/json", (_request, response) => { response.sendStatus(204); });
const errors: Record<string, Error> = {
  unexpected: new Error("private database information"),
  oversized: new MulterError("LIMIT_FILE_SIZE"),
  type: new ApiError(415, "Unsupported file type", "UNSUPPORTED_FILE_TYPE"),
  duplicate: new Prisma.PrismaClientKnownRequestError("private duplicate details", { code: "P2002", clientVersion: "6" }),
  unavailable: new Prisma.PrismaClientKnownRequestError("private pool details", { code: "P2024", clientVersion: "6" }),
};
app.get("/:failure", (req, _response, next) => { next(errors[req.params.failure]); });
app.use(errorHandler);

describe("safe global error responses", () => {
  it.each([["unexpected", 500], ["oversized", 413], ["type", 415], ["duplicate", 409], ["unavailable", 503]])("maps %s without leaking internals", async (failure, status) => {
    const response = await request(app).get(`/${failure}`);
    expect(response.status).toBe(status);
    expect(response.text).not.toContain("private");
    expect(response.text).not.toContain('"stack"');
  });
  it("rejects malformed JSON accurately", async () => {
    const response = await request(app).post("/json").set("Content-Type", "application/json").send('{"broken":');
    expect(response.status).toBe(400);
    expect(response.text).toContain("INVALID_JSON");
  });
  it("rejects oversized JSON accurately", async () => {
    const response = await request(app).post("/json").send({ value: "x".repeat(2048) });
    expect(response.status).toBe(413);
  });
});
