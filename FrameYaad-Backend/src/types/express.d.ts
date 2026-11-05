import type { UserView } from "../utils/user-view";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        accessToken: string;
        user: UserView;
      };
    }
  }
}

export {};
