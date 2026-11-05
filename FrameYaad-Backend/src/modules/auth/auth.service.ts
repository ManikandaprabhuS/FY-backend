import { UserRole } from "@prisma/client";
import type { Session } from "@supabase/supabase-js";

import { env } from "../../config/env";
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
  resetPasswordSchema,
} from "./auth.schemas";

type RegistrationInput = z.infer<typeof registrationSchema>;
type CustomerRegistrationInput = z.infer<typeof customerRegistrationSchema>;
type LoginInput = z.infer<typeof loginSchema>;
type ProfileInput = z.infer<typeof profileFieldsSchema>;
type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

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
  const client = createUserSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { name: input.name, gender: input.gender } },
  });

  if (error || !data.user || data.user.identities?.length === 0) {
    throw new ApiError(409, "An account with this email already exists", "ACCOUNT_ALREADY_EXISTS");
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
  input: RegistrationInput,
  actor?: UserView,
): Promise<UserView> => {
  const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } });
  if (adminCount > 0 && actor?.role !== UserRole.ADMIN) {
    throw new ApiError(403, "Only an admin can register another admin", "ADMIN_REGISTRATION_FORBIDDEN");
  }
  return createManagedUser(input, UserRole.ADMIN, actor?.id);
};

export const createEmployeeAccount = (input: RegistrationInput, adminId: string): Promise<UserView> =>
  createManagedUser(input, UserRole.EMPLOYEE, adminId);

export const login = async (
  input: LoginInput,
  expectedRole: UserRole | readonly UserRole[],
): Promise<AuthenticationResult> => {
  const client = createUserSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword(input);
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
    throw new ApiError(401, "Email or password is incorrect", "INVALID_CREDENTIALS");
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

export const requestPasswordReset = async (email: string): Promise<void> => {
  const client = createUserSupabaseClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: env.PASSWORD_RESET_REDIRECT_URL,
  });
  if (error) {
    throw new ApiError(502, "Password reset email could not be sent", "PASSWORD_RESET_DELIVERY_FAILED");
  }
};

export const resetPassword = async (input: ResetPasswordInput): Promise<void> => {
  const client = createUserSupabaseClient();
  if (input.refreshToken) {
    const { error: sessionError } = await client.auth.setSession({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    });
    if (sessionError) throw new ApiError(401, "Recovery session is invalid", "INVALID_RECOVERY_SESSION");
  } else {
    const { data, error } = await supabaseAdmin.auth.getUser(input.accessToken);
    if (error || !data.user) throw new ApiError(401, "Recovery token is invalid", "INVALID_RECOVERY_TOKEN");
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(input.accessToken);
  if (userError || !userData.user) {
    throw new ApiError(401, "Recovery token is invalid", "INVALID_RECOVERY_TOKEN");
  }
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userData.user.id, {
    password: input.newPassword,
  });
  if (error) throw new ApiError(400, "Password could not be reset", "PASSWORD_RESET_FAILED");
  await supabaseAdmin.auth.admin.signOut(input.accessToken, "global");
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
