import type { SuppressionKind } from "@enrich/shared";
import { normaliseDomain, normaliseEmail } from "./normalise";

export interface ParsedSuppression {
  kind: SuppressionKind;
  value: string;
}

const HEADER_WORDS = /^(email|e-mail|domain|website|url|company|name|first ?name|last ?name|title|reason)$/i;

/**
 * Pulls suppressible values out of pasted text or a CSV: one entry per line, comma, semicolon or tab.
 * Emails stay emails; URLs and bare hosts become domains (`https://www.Acme.com/x` → `acme.com`).
 * Header cells and anything that is neither are returned in `skipped`.
 */
export function parseSuppressionEntries(text: string): { entries: ParsedSuppression[]; skipped: string[] } {
  const seen = new Set<string>();
  const entries: ParsedSuppression[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/[\r\n,;\t]+/)) {
    const cell = raw.trim().replace(/^["']|["']$/g, "").trim();
    if (!cell) continue;
    if (HEADER_WORDS.test(cell)) continue;
    const email = cell.includes("@") ? normaliseEmail(cell) : undefined;
    const entry: ParsedSuppression | undefined = email
      ? { kind: "email", value: email }
      : !cell.includes("@") && !/\s/.test(cell)
        ? (() => {
            const domain = normaliseDomain(cell);
            return domain ? { kind: "domain" as const, value: domain } : undefined;
          })()
        : undefined;
    if (!entry) {
      if (skipped.length < 50) skipped.push(cell);
      continue;
    }
    const key = `${entry.kind}:${entry.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return { entries, skipped };
}
