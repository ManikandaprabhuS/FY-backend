import type { RequestHandler } from "express";

import { logger } from "../config/logger";

interface MethodLogDefinition {
  method: string;
  path: RegExp;
  message: string;
}

const methodLogs: readonly MethodLogDefinition[] = [
  { method: "GET", path: /^\/health\/?$/, message: "Health Check method is calling" },

  { method: "POST", path: /^\/auth\/customer\/register\/?$/, message: "Customer Register method is calling" },
  { method: "POST", path: /^\/auth\/admin\/register\/?$/, message: "Admin Register method is calling" },
  { method: "POST", path: /^\/auth\/customer\/login\/?$/, message: "Customer Login method is calling" },
  { method: "POST", path: /^\/auth\/admin\/login\/?$/, message: "Admin Login method is calling" },
  { method: "POST", path: /^\/auth\/employee\/login\/?$/, message: "Employee Login method is calling" },
  { method: "POST", path: /^\/auth\/staff\/login\/?$/, message: "Staff Login method is calling" },
  { method: "POST", path: /^\/auth\/refresh\/?$/, message: "Session Refresh method is calling" },
  { method: "POST", path: /^\/auth\/logout\/?$/, message: "Logout method is calling" },
  { method: "GET", path: /^\/auth\/me\/?$/, message: "Get Logged-in User method is calling" },
  { method: "PATCH", path: /^\/auth\/profile\/?$/, message: "Profile Update method is calling" },
  { method: "POST", path: /^\/auth\/forgot-password\/?$/, message: "Forgot Password method is calling" },
  { method: "POST", path: /^\/auth\/reset-password\/?$/, message: "Reset Password method is calling" },
  { method: "POST", path: /^\/auth\/change-password\/?$/, message: "Change Password method is calling" },

  { method: "GET", path: /^\/users\/?$/, message: "Customer List method is calling" },
  { method: "GET", path: /^\/users\/[^/]+\/?$/, message: "Customer Details method is calling" },
  { method: "PATCH", path: /^\/users\/[^/]+\/?$/, message: "Customer Update method is calling" },

  { method: "POST", path: /^\/employees\/?$/, message: "Employee Add method is calling" },
  { method: "GET", path: /^\/employees\/?$/, message: "Employee List method is calling" },
  { method: "GET", path: /^\/employees\/[^/]+\/?$/, message: "Employee Details method is calling" },
  { method: "PATCH", path: /^\/employees\/[^/]+\/?$/, message: "Employee Update method is calling" },
  { method: "DELETE", path: /^\/employees\/[^/]+\/?$/, message: "Employee Delete method is calling" },

  { method: "GET", path: /^\/products\/?$/, message: "Product List method is calling" },
  { method: "GET", path: /^\/products\/[^/]+\/?$/, message: "Product Details method is calling" },
  { method: "POST", path: /^\/products\/?$/, message: "Product Add method is calling" },
  { method: "PATCH", path: /^\/products\/[^/]+\/?$/, message: "Product Update method is calling" },
  { method: "DELETE", path: /^\/products\/[^/]+\/?$/, message: "Product Delete method is calling" },

  { method: "GET", path: /^\/addresses\/?$/, message: "Address List method is calling" },
  { method: "GET", path: /^\/addresses\/[^/]+\/?$/, message: "Address Details method is calling" },
  { method: "POST", path: /^\/addresses\/?$/, message: "Address Add method is calling" },
  { method: "PATCH", path: /^\/addresses\/[^/]+\/?$/, message: "Address Update method is calling" },
  { method: "DELETE", path: /^\/addresses\/[^/]+\/?$/, message: "Address Delete method is calling" },

  { method: "GET", path: /^\/cart\/?$/, message: "Cart View method is calling" },
  { method: "POST", path: /^\/cart\/items\/?$/, message: "Cart Item Add method is calling" },
  { method: "PATCH", path: /^\/cart\/items\/[^/]+\/?$/, message: "Cart Item Update method is calling" },
  { method: "DELETE", path: /^\/cart\/items\/[^/]+\/?$/, message: "Cart Item Remove method is calling" },
  { method: "DELETE", path: /^\/cart\/?$/, message: "Cart Clear method is calling" },

  { method: "POST", path: /^\/orders\/checkout\/?$/, message: "Order Checkout method is calling" },
  { method: "GET", path: /^\/orders\/?$/, message: "Order List method is calling" },
  { method: "GET", path: /^\/orders\/[^/]+\/?$/, message: "Order Details method is calling" },
  { method: "PATCH", path: /^\/orders\/[^/]+\/status\/?$/, message: "Order Status Update method is calling" },

  { method: "GET", path: /^\/wishlist\/?$/, message: "Wishlist View method is calling" },
  { method: "POST", path: /^\/wishlist\/?$/, message: "Wishlist Product Add method is calling" },
  { method: "DELETE", path: /^\/wishlist\/[^/]+\/?$/, message: "Wishlist Product Remove method is calling" },

  { method: "GET", path: /^\/notifications\/?$/, message: "Notification List method is calling" },
  { method: "GET", path: /^\/notifications\/unread-count\/?$/, message: "Notification Unread Count method is calling" },
  { method: "PATCH", path: /^\/notifications\/read-all\/?$/, message: "Notification Mark All Read method is calling" },
  { method: "PATCH", path: /^\/notifications\/[^/]+\/read\/?$/, message: "Notification Mark Read method is calling" },
  { method: "DELETE", path: /^\/notifications\/[^/]+\/?$/, message: "Notification Delete method is calling" },
];

export const methodCallMessage = (method: string, path: string): string =>
  methodLogs.find((definition) => definition.method === method && definition.path.test(path))?.message
  ?? `${method} ${path} API method is calling`;

export const logMethodCall: RequestHandler = (request, _response, next) => {
  const message = methodCallMessage(request.method, request.path);
  logger.info(
    { requestId: request.requestId, httpMethod: request.method, path: request.path },
    message,
  );
  // Required as a plain-text companion to the structured deployment logger.
  console.log(message);
  next();
};
