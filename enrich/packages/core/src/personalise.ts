// Guardrails shared by every generated snippet; the writer and its checks live in variables.ts.

// Phrases that give away the website visit. Bare "visit" is allowed: it is part of names like "Visit Seattle".
const TRACKING_PHRASES = [
  /\b(visited|visiting|browsed|browsing|checked out|checking out|looked at|looking at|viewed|viewing|landed on)\s+(our|my)\b/i,
  /\byour (recent |latest )?(visit|visits|browsing|time on)\b/i,
  /\b(our|my) (web ?site|site|pricing page|landing page|page)\b/i,
  /\btrack(ed|ing)\b/i,
  /\b(saw|noticed|see|seen)( that)? you\b/i,
];

/** True when the text gives away the website visit or tracking. */
export function mentionsTracking(text: string): boolean {
  return TRACKING_PHRASES.some((pattern) => pattern.test(text));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
