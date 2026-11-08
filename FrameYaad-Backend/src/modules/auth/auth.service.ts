import { UserRole } from "@prisma/client";
import type { Session } from "@supabase/supabase-js";

import { logger } from "../../config/logger";
import { createUserSupabaseClient, supabaseAdmin } from "../../config/supabase";
import { prisma } from "../../prisma/client";
import { ApiError } from "../../utils/api-error";
import { userViewSelect, type UserView } from "../../utils/user-view";
import { createCustomerRegistrationNotifications } from "../notifications/notification-events.service";
import type { z } from "zod";
import type {
  changePasswordSchema,
  customerRegistrationSchema,
  loginSchema,
  profileFieldsSchema,
  registrationSchema,
  adminRegistrationSchema,
} from "./auth.schemas";

type RegistrationInput = z.infer<typeof registrationSchema>;
type CustomerRegistrationInput = z.infer<typeof customerRegistrationSchema>;
type LoginInput = z.infer<typeof loginSchema>;
type ProfileInput = z.infer<typeof profileFieldsSchema>;
type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface AuthenticationResult {
  session: Session | null;
  user: UserView;
}

const createManagedUser = async (
  input: RegistrationInput,
  role: UserRole,
  createdById?: string,
): Promise<UserView> => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { name: input.name },
  });

  if (error || !data.user) {
    throw new ApiError(400, "Unable to create account", "AUTH_ACCOUNT_CREATION_FAILED");
  }

  try {
    return await prisma.user.create({
      data: {
        id: data.user.id,
        name: input.name,
        email: input.email,
        phoneNumber: input.phoneNumber,
        role,
        isEmailVerified: Boolean(data.user.email_confirmed_at),
        createdById,
      },
      select: userViewSelect,
    });
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    throw error;
  }
};

export const registerCustomer = async (input: CustomerRegistrationInput): Promise<AuthenticationResult> => {
  const existing = await prisma.user.findFirst({
    where: { email: { equals: input.email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(409, "An account with this email already exists", "ACCOUNT_ALREADY_EXISTS");
  }
  const client = createUserSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { name: input.name, gender: input.gender } },
  });

  if (error) {
    logger.warn(
      { supabaseStatus: error.status, supabaseCode: error.code, supabaseError: error.message },
      "Supabase customer registration failed",
    );
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      throw new ApiError(409, "An account with this email already exists", "ACCOUNT_ALREADY_EXISTS");
    }
    if (error.status === 429) {
      throw new ApiError(429, "Too many signup attempts. Please wait before trying again", "SIGNUP_RATE_LIMITED");
    }
    if (error.status === undefined || error.status === 0 || error.status >= 500) {
      throw new ApiError(502, "Account creation or confirmation email delivery is temporarily unavailable. Please try again later", "SIGNUP_PROVIDER_UNAVAILABLE");
    }
    if (error.code === "weak_password") {
      throw new ApiError(400, "This password does not meet the password requirements", "WEAK_PASSWORD");
    }
    throw new ApiError(400, "Unable to create your account. Please check your details and try again", "SIGNUP_FAILED");
  }
  if (data.user?.identities?.length === 0) {
    throw new ApiError(409, "An account with this email already exists", "ACCOUNT_ALREADY_EXISTS");
  }
  if (!data.user) {
    throw new ApiError(502, "Account creation is temporarily unavailable. Please try again later", "SIGNUP_PROVIDER_UNAVAILABLE");
  }
  const authUser = data.user;

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const profile = await transaction.user.create({
        data: {
          id: authUser.id,
          name: input.name,
          email: input.email,
          phoneNumber: input.phoneNumber,
          gender: input.gender,
          role: UserRole.CUSTOMER,
          isEmailVerified: Boolean(authUser.email_confirmed_at),
        },
        select: userViewSelect,
      });
      await createCustomerRegistrationNotifications(transaction, profile);
      return profile;
    });
    await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      app_metadata: { role: UserRole.CUSTOMER },
    });
    return { session: data.session, user };
  } catch (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authUser.id);
    throw profileError;
  }
};

export const registerAdmin = async (
  input: z.infer<typeof adminRegistrationSchema>,
  actor?: UserView,
): Promise<UserView> => {
  if (!actor) throw new ApiError(401, "Authentication is required", "AUTHENTICATION_REQUIRED");
  if (actor.role !== UserRole.ADMIN || !actor.isActive) {
    throw new ApiError(403, "Only an admin can register another admin", "ADMIN_REGISTRATION_FORBIDDEN");
  }
  const { data, error } = await createUserSupabaseClient().auth.signInWithPassword({
    email: actor.email,
    password: input.currentPassword,
  });
  if (error || !data.user || !data.session) {
    if (error?.code === "invalid_credentials") {
      throw new ApiError(403, "Admin password confirmation failed", "ADMIN_CONFIRMATION_FAILED");
    }
    throw new ApiError(502, "Unable to confirm admin credentials. Please try again", "AUTH_PROVIDER_UNAVAILABLE");
  }
  await supabaseAdmin.auth.admin.signOut(data.session.access_token, "local");
  if (data.user.id !== actor.id) {
    throw new ApiError(403, "Admin password confirmation failed", "ADMIN_CONFIRMATION_FAILED");
  }
  const { currentPassword: _currentPassword, ...registration } = input;
  void _currentPassword;
  const user = await createManagedUser(registration, UserRole.ADMIN, actor.id);
  logger.info({ event: "ADMIN_ACCOUNT_CREATED", actorId: actor.id, createdUserId: user.id, createdAt: new Date().toISOString() }, "Admin account created");
  return user;
};

export const createEmployeeAccount = (input: RegistrationInput, adminId: string): Promise<UserView> =>
  createManagedUser(input, UserRole.EMPLOYEE, adminId);

export const login = async (
  input: LoginInput,
  expectedRole: UserRole | readonly UserRole[],
): Promise<AuthenticationResult> => {
  const client = createUserSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: input.email.trim().toLowerCase(),
    password: input.password,
  });
  if (error) {
    logger.warn(
      { supabaseStatus: error.status, supabaseCode: error.code, supabaseError: error.message },
      "Supabase login request failed",
    );
    const normalizedMessage = error.message.toLowerCase();
    if (error.code === "email_not_confirmed" || normalizedMessage.includes("email not confirmed")) {
      throw new ApiError(403, "Please verify your email to continue", "EMAIL_NOT_VERIFIED");
    }
    if (error.code !== "invalid_credentials") {
      throw new ApiError(502, "Authentication service is temporarily unavailable", "AUTH_PROVIDER_UNAVAILABLE");
    }
    throw new ApiError(401, "Email or password is incorrect", "INVALID_CREDENTIALS");
  }
  if (!data.session || !data.user) {
    throw new ApiError(502, "Authentication service returned an incomplete session. Please try again.", "AUTH_PROVIDER_UNAVAILABLE");
  }

  const user = await prisma.user.findUnique({ where: { id: data.user.id }, select: userViewSelect });
  const allowedRoles = Array.isArray(expectedRole) ? expectedRole : [expectedRole];
  if (!user || !allowedRoles.includes(user.role)) {
    await supabaseAdmin.auth.admin.signOut(data.session.access_token, "global");
    throw new ApiError(403, "This account cannot use the selected login", "ROLE_LOGIN_FORBIDDEN");
  }
  if (!user.isActive) {
    await supabaseAdmin.auth.admin.signOut(data.session.access_token, "global");
    throw new ApiError(403, "Account is deactivated", "ACCOUNT_DEACTIVATED");
  }
  return { session: data.session, user };
};

export const refreshSession = async (refreshToken: string): Promise<AuthenticationResult> => {
  const client = createUserSupabaseClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) {
    throw new ApiError(401, "Session cannot be refreshed", "INVALID_REFRESH_TOKEN");
  }
  const user = await prisma.user.findUnique({ where: { id: data.user.id }, select: userViewSelect });
  if (!user || !user.isActive) {
    await supabaseAdmin.auth.admin.signOut(data.session.access_token, "global");
    throw new ApiError(403, "Account is unavailable", "ACCOUNT_UNAVAILABLE");
  }
  return { session: data.session, user };
};

export const logout = async (accessToken?: string): Promise<void> => {
  if (!accessToken) return;
  const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, "global");
  if (error && error.status !== 401) {
    throw new ApiError(502, "Session could not be revoked", "LOGOUT_FAILED");
  }
};


export const changePassword = async (
  user: UserView,
  accessToken: string,
  input: ChangePasswordInput,
): Promise<void> => {
  const verifier = createUserSupabaseClient();
  const { data: verificationData, error: verificationError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (verificationError) {
    throw new ApiError(400, "Current password is incorrect", "CURRENT_PASSWORD_INCORRECT");
  }
  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: input.newPassword,
  });
  if (error) {
    if (verificationData.session) {
      await supabaseAdmin.auth.admin.signOut(verificationData.session.access_token, "local");
    }
    throw new ApiError(400, "Password could not be changed", "PASSWORD_CHANGE_FAILED");
  }
  await supabaseAdmin.auth.admin.signOut(accessToken, "global");
};

export const updateOwnProfile = async (userId: string, input: ProfileInput): Promise<UserView> => {
  if (input.phoneNumber !== undefined && input.phoneNumber !== null) {
    const normalizedPhone = input.phoneNumber.replace(/[\s()-]/g, '');
    const conflict = await prisma.user.findFirst({
      where: { phoneNumber: normalizedPhone, NOT: { id: userId } },
      select: { id: true },
    });
    if (conflict) {
      throw new ApiError(409, "This phone number is already used by another account", "PHONE_NUMBER_IN_USE");
    }
    input = { ...input, phoneNumber: normalizedPhone };
  }
  return prisma.user.update({ where: { id: userId }, data: input, select: userViewSelect });
};
