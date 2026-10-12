import { constantTimeEqual } from "@enrich/shared/crypto";
import { getEnv } from "@enrich/shared/env";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "enrich_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface Session {
  uid: string;
  email: string;
  /** Expiry, unix seconds. */
  exp: number;
}

export class AuthConfigError extends Error {}

function secret(): string {
  const value = getEnv().SESSION_SECRET;
  if (!value) throw new AuthConfigError("SESSION_SECRET is not set in .env (generate with: openssl rand -base64 32)");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Cookie value `base64url(json).hmac`. */
export function encodeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string): Session | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!constantTimeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return typeof session.exp === "number" && session.exp > Date.now() / 1000 ? session : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    return decodeSession(token);
  } catch (error) {
    if (error instanceof AuthConfigError) return null;
    throw error;
  }
}

/** Use at the top of every admin page and server action. */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function startSession(user: { id: string; email: string }): Promise<void> {
  const session: Session = { uid: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  (await cookies()).set(COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
