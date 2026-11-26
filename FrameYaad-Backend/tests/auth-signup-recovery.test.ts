import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(), verifyOtp: vi.fn(), resetPasswordForEmail: vi.fn(), setSession: vi.fn(),
  getUser: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(), deleteUser: vi.fn(),
  findUser: vi.fn(), createUser: vi.fn(), transaction: vi.fn(), notify: vi.fn(),
}));

vi.mock("../src/config/supabase", () => ({
  createUserSupabaseClient: () => ({ auth: {
    signUp: mocks.signUp, verifyOtp: mocks.verifyOtp,
    resetPasswordForEmail: mocks.resetPasswordForEmail, setSession: mocks.setSession,
  } }),
  supabaseAdmin: { auth: {
    getUser: mocks.getUser,
    admin: { updateUserById: mocks.updateUser, signOut: mocks.signOut, deleteUser: mocks.deleteUser },
  } },
}));
vi.mock("../src/prisma/client", () => ({ prisma: {
  user: { findFirst: mocks.findUser, findUnique:mocks.findUser }, $transaction: mocks.transaction,
} }));
vi.mock("../src/modules/notifications/notification-events.service", () => ({ createCustomerRegistrationNotifications: mocks.notify }));

import { registerCustomer,confirmCustomerSession } from "../src/modules/auth/auth.service";
import {env} from '../src/config/env';

const input = { name: "New Customer", email: "new@example.com", password: "Password123!", gender: "FEMALE" as const };
const user = { id: "11111111-1111-4111-8111-111111111111", email: input.email, identities: [{ id: "identity-1" }] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUser.mockResolvedValue(null);
  mocks.signUp.mockResolvedValue({ data: { user, session: null }, error: null });
  mocks.createUser.mockResolvedValue({ ...user, name: input.name });
  mocks.transaction.mockImplementation((operation: (transaction: { user: { create: typeof mocks.createUser } }) => Promise<unknown>) => operation({ user: { create: mocks.createUser } }));
  mocks.updateUser.mockResolvedValue({ data: { user }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.setSession.mockResolvedValue({ data: {}, error: null });
});

describe("signup duplicate detection", () => {
  it('uses the existing frontend environment for the confirmation callback without changing metadata',async()=>{
    await registerCustomer(input);
    expect(mocks.signUp).toHaveBeenCalledWith({email:input.email,password:input.password,options:{emailRedirectTo:new URL('/auth/callback',env.FRONTEND_URL).href,data:{name:input.name,gender:input.gender}}});
  });
  it("rejects an exact email match without calling signup", async () => {
    mocks.findUser.mockResolvedValue({ id: user.id });
    await expect(registerCustomer(input)).rejects.toMatchObject({ statusCode: 409, code: "ACCOUNT_ALREADY_EXISTS" });
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true } });
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("allows different new emails and creates their profiles", async () => {
    await registerCustomer(input);
    await registerCustomer({ ...input, email: "another@example.com" });
    expect(mocks.signUp).toHaveBeenCalledTimes(2);
    expect(mocks.signUp).toHaveBeenLastCalledWith(expect.objectContaining({ email: "another@example.com" }));
    expect(mocks.createUser).toHaveBeenCalledTimes(2);
  });

  it("reports SMTP/provider errors as unavailable, not duplicate email", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: null }, error: { status: 500, code: "unexpected_failure" } });
    await expect(registerCustomer(input)).rejects.toMatchObject({ statusCode: 502, code: "SIGNUP_PROVIDER_UNAVAILABLE" });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("reports rate limits without claiming the email is registered", async () => {
    mocks.signUp.mockResolvedValue({ data: {}, error: { status: 429, code: "over_email_send_rate_limit" } });
    await expect(registerCustomer(input)).rejects.toMatchObject({ statusCode: 429, code: "SIGNUP_RATE_LIMITED" });
  });

  it.each(["user_already_exists", "email_exists"])("recognizes provider duplicate code %s", async (code) => {
    mocks.signUp.mockResolvedValue({ data: {}, error: { status: 422, code } });
    await expect(registerCustomer(input)).rejects.toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });
  });

  it("recognizes Supabase's obfuscated existing-user response", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { ...user, identities: [] } }, error: null });
    await expect(registerCustomer(input)).rejects.toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });
  });

  it("does not label an empty provider response as a duplicate", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: null }, error: null });
    await expect(registerCustomer(input)).rejects.toMatchObject({ code: "SIGNUP_PROVIDER_UNAVAILABLE" });
  });

  it("keeps weak password errors separate", async () => {
    mocks.signUp.mockResolvedValue({ data: {}, error: { status: 422, code: "weak_password" } });
    await expect(registerCustomer(input)).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });
});

describe('confirmation session bridge',()=>{
 it('accepts only a verified active customer and never creates another profile',async()=>{
  const session={access_token:'verified-access',refresh_token:'verified-refresh',expires_in:3600};
  mocks.setSession.mockResolvedValue({data:{session},error:null});
  mocks.getUser.mockResolvedValue({data:{user:{...user,email_confirmed_at:'2026-11-26T00:00:00Z'}},error:null});
  mocks.findUser.mockResolvedValue({...user,role:'CUSTOMER',isActive:true});
  expect((await confirmCustomerSession({access_token:'a',refresh_token:'r'})).session).toEqual(session);
  expect(mocks.createUser).not.toHaveBeenCalled();expect(mocks.signUp).not.toHaveBeenCalled();
 });
 it('rejects invalid/expired sessions',async()=>{
  mocks.setSession.mockResolvedValue({data:{session:null},error:{message:'expired'}});
  await expect(confirmCustomerSession({access_token:'a',refresh_token:'r'})).rejects.toMatchObject({statusCode:401});
 });
 it('rejects an unconfirmed email even if tokens are supplied',async()=>{
  mocks.setSession.mockResolvedValue({data:{session:{access_token:'a'}},error:null});
  await expect(confirmCustomerSession({access_token:'a',refresh_token:'r'})).rejects.toMatchObject({code:'EMAIL_NOT_VERIFIED'});
 });
 it.each([{role:'ADMIN',isActive:true},{role:'CUSTOMER',isActive:false}])('does not bypass account restrictions: %o',async fields=>{
  mocks.setSession.mockResolvedValue({data:{session:{access_token:'a'}},error:null});
  mocks.getUser.mockResolvedValue({data:{user:{...user,email_confirmed_at:'2026-11-26T00:00:00Z'}},error:null});
  mocks.findUser.mockResolvedValue({...user,...fields});
  await expect(confirmCustomerSession({access_token:'a',refresh_token:'r'})).rejects.toMatchObject({statusCode:403});
 });
});

