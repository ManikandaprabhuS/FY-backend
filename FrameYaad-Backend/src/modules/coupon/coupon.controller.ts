import type { RequestHandler } from "express";
import type { z } from "zod";
import { ApiError } from "../../utils/api-error";
import { couponIdSchema, couponStatusSchema, createCouponSchema, updateCouponSchema, validateCouponSchema } from "./coupon.schemas";
import * as service from "./coupon.service";

const authId = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  return request.auth.user.id;
};
const id = (value: unknown) => couponIdSchema.parse(value);

export const list: RequestHandler = async (req, res) => res.json({ success: true, data: await service.listCoupons(req.query) });
export const validate: RequestHandler = async (req, res) => res.json({ success: true, data: await service.validateCoupon(req.body as z.infer<typeof validateCouponSchema>) });
export const get: RequestHandler = async (req, res) => res.json({ success: true, data: { coupon: await service.getCoupon(id(req.params.id)) } });
export const create: RequestHandler = async (req, res) => res.status(201).json({ success: true, data: { coupon: await service.createCoupon(req.body as z.infer<typeof createCouponSchema>, authId(req)) } });
export const update: RequestHandler = async (req, res) => res.json({ success: true, data: { coupon: await service.updateCoupon(id(req.params.id), req.body as z.infer<typeof updateCouponSchema>) } });
export const status: RequestHandler = async (req, res) => {
  const parsed = couponStatusSchema.parse(req.body);
  res.json({ success: true, data: { coupon: await service.updateCouponStatus(id(req.params.id), parsed.isActive) } });
};
export const remove: RequestHandler = async (req, res) => { await service.deleteCoupon(id(req.params.id)); res.status(204).send(); };
