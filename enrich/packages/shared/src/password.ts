import bcrypt from "bcryptjs";

const ROUNDS = 12;

// Compared against when the email is unknown, so a miss costs the same as a wrong password.
const DUMMY_HASH = "$2b$12$H4iDBXe4q6eLub9bPzJQvO3k34Is1kqBFt2h/TxSpTzICBjiw7j5q";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH).then((ok) => ok && hash !== undefined);
}
