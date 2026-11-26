import type { RequestHandler } from 'express';
import { env } from '../../config/env';
import {ApiError} from '../../utils/api-error';

// Authenticate middleware verifies the existing Supabase token and active database role.
// No refresh token, service-role credential, or frontend-supplied identity is accepted.
export const notificationRealtimeSession: RequestHandler = (request, response) => {
  let privileged=env.SUPABASE_ANON_KEY===env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_ANON_KEY.startsWith('sb_secret_');
  try{
    const claims:unknown=JSON.parse(Buffer.from(env.SUPABASE_ANON_KEY.split('.')[1]??'','base64url').toString('utf8'));
    if(claims&&typeof claims==='object'&&'role' in claims&&claims.role==='service_role')privileged=true;
  }catch{/* Publishable keys are not JWTs. This is a configuration check, not token authentication. */}
  if(privileged)throw new ApiError(503,'Public Realtime key is misconfigured','REALTIME_CONFIGURATION_ERROR');
  response.setHeader('Cache-Control', 'no-store');
  response.json({ success: true, data: {
    userId: request.auth!.user.id,
    role: request.auth!.user.role,
    accessToken: request.auth!.accessToken,
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
  } });
};
