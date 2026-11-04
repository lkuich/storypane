import { betterAuth } from 'better-auth'
import type { Pool } from 'pg'

export function createAuth(db: Pool, secret: string, baseURL: string, allowSignup = false) {
  return betterAuth({
    database: db,
    secret,
    baseURL,
    trustedOrigins: [baseURL],
    emailAndPassword: { enabled: true, disableSignUp: !allowSignup, minPasswordLength: 12 },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },
    session: { expiresIn: 60 * 60 * 24 * 7, disableSessionRefresh: true },
  })
}
