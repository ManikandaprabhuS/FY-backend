import { UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), user: vi.fn(), list: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("../src/config/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: mocks.getUser },
    storage: {
      from: () => ({
        list: mocks.list,
        upload: mocks.upload,
        remove: mocks.remove,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
  createUserSupabaseClient: vi.fn(),
}));
vi.mock("../src/prisma/client", () => ({ prisma: { user: { findUnique: mocks.user, update: vi.fn() } } }));

import { app } from "../src/app";
import { clearHeroVideoCache } from "../src/modules/site-media/site-media.service";

const id = "77777777-7777-4777-8777-777777777777";
const asRole = (role: UserRole) => {
  mocks.getUser.mockResolvedValue({ data: { user: { id, email_confirmed_at: "2026-08-01T00:00:00Z", phone_confirmed_at: null } }, error: null });
  mocks.user.mockResolvedValue({ id, role, isActive: true, isEmailVerified: true, isPhoneNumberVerified: false });
};
// The smallest buffer that passes the MP4 signature check ("ftyp" at byte 4).
const videoOf = (response: { body: unknown }) => (response.body as { data: { video: { url: string; updatedAt: string | null } | null } }).data.video;
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12)]);

beforeEach(() => {
  vi.clearAllMocks();
  clearHeroVideoCache();
  asRole(UserRole.ADMIN);
  mocks.list.mockResolvedValue({ data: [], error: null });
  mocks.upload.mockResolvedValue({ data: {}, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
});

it("returns null publicly when no hero video is set", async () => {
  const response = await request(app).get("/api/v1/site-media/hero-video");
  expect(response.status).toBe(200);
  expect(videoOf(response)).toBeNull();
});

it("returns the newest stored hero video", async () => {
  mocks.list.mockResolvedValue({ data: [{ name: "200-b.mp4", created_at: "2026-11-10T10:00:00Z" }, { name: "100-a.mp4" }], error: null });
  const response = await request(app).get("/api/v1/site-media/hero-video");
  expect(videoOf(response)).toEqual({ url: "https://cdn.test/site/hero-video/200-b.mp4", updatedAt: "2026-11-10T10:00:00Z" });
});

it.each([UserRole.ADMIN, UserRole.EMPLOYEE])("lets %s replace the video and removes the old one", async (role) => {
  asRole(role);
  mocks.list.mockResolvedValue({ data: [{ name: "100-old.mp4" }], error: null });
  const response = await request(app)
    .put("/api/v1/site-media/hero-video")
    .set("Authorization", "Bearer staff")
    .attach("video", mp4, { filename: "hero.mp4", contentType: "video/mp4" });
  expect(response.status).toBe(200);
  expect(mocks.upload).toHaveBeenCalledWith(expect.stringMatching(/^site\/hero-video\/\d+-.+\.mp4$/), expect.any(Buffer), expect.objectContaining({ contentType: "video/mp4", upsert: false }));
  expect(mocks.remove).toHaveBeenCalledWith(["site/hero-video/100-old.mp4"]);
  expect(videoOf(response)?.url).toMatch(/^https:\/\/cdn\.test\/site\/hero-video\//);

  // The new video is served straight away, without another storage lookup.
  mocks.list.mockClear();
  const current = await request(app).get("/api/v1/site-media/hero-video");
  expect(videoOf(current)?.url).toBe(videoOf(response)?.url);
  expect(mocks.list).not.toHaveBeenCalled();
});

it("rejects customers, anonymous callers and non-MP4 files", async () => {
  expect((await request(app).put("/api/v1/site-media/hero-video").attach("video", mp4, { filename: "hero.mp4", contentType: "video/mp4" })).status).toBe(401);
  asRole(UserRole.CUSTOMER);
  expect((await request(app).put("/api/v1/site-media/hero-video").set("Authorization", "Bearer customer").attach("video", mp4, { filename: "hero.mp4", contentType: "video/mp4" })).status).toBe(403);
  asRole(UserRole.ADMIN);
  expect((await request(app).put("/api/v1/site-media/hero-video").set("Authorization", "Bearer staff").attach("video", Buffer.from("not a video"), { filename: "hero.png", contentType: "image/png" })).status).toBe(415);
  expect((await request(app).put("/api/v1/site-media/hero-video").set("Authorization", "Bearer staff").attach("video", Buffer.from("not a video"), { filename: "hero.mp4", contentType: "video/mp4" })).status).toBe(415);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("lets staff remove the video", async () => {
  mocks.list.mockResolvedValue({ data: [{ name: "100-a.mp4" }], error: null });
  const response = await request(app).delete("/api/v1/site-media/hero-video").set("Authorization", "Bearer staff");
  expect(response.status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith(["site/hero-video/100-a.mp4"]);
  expect(videoOf(await request(app).get("/api/v1/site-media/hero-video"))).toBeNull();
});
