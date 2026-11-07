import type { Pool } from 'pg';
import type { Actor } from '@storypane/core';

export type AuthSession = {
  user: { id: string; name: string; email: string };
  session: { id: string };
};
export type AuthConfig =
  | { provider: 'local'; passwordReset: boolean }
  | { provider: 'clerk'; publishableKey: string }
  | { provider: 'redirect'; name: string; signInPath: string };

export interface AuthRouteTools {
  assertOrigin(request: Request): void;
  readJson(request: Request): Promise<unknown>;
  rateLimit(subject: string): Promise<void>;
}

/** One scope per HTTP request or room operation; never cache completed identity checks globally. */
export interface Authentication {
  config(): AuthConfig;
  getSession(request: Request): Promise<AuthSession | null>;
  assertSession(actor: Pick<Actor, 'userId' | 'sessionId'>): Promise<void>;
  assertIdentity(userId: string): Promise<void>;
  handle(request: Request, tools: AuthRouteTools): Promise<Response>;
}

export type AuthenticationFactory = (options: {
  pool: Pool;
  provider: string;
  appURL: string;
  secret?: string;
  smtpURL?: string;
  mailFrom?: string;
  clerkSecretKey?: string;
  clerkPublishableKey?: string;
}) => Authentication;
