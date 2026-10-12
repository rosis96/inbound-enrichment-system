import type { Seniority } from "@enrich/shared";

const RULES: [Seniority, RegExp][] = [
  ["owner", /\b(owner|founder|co-?founder|proprietor)\b/],
  ["c_level", /\b(ceo|cto|cfo|coo|cmo|cio|cro|chief|president|managing director|partner)\b/],
  ["director", /\b(director|head of|vp|vice president)\b/],
  ["manager", /\b(manager|lead|supervisor)\b/],
];

/** Rough seniority bucket from a job title; `ic` when nothing matches. */
export function seniorityFromTitle(title: string): Seniority {
  const lower = title.toLowerCase();
  return RULES.find(([, pattern]) => pattern.test(lower))?.[0] ?? "ic";
}

/** Higher is more senior. */
export const SENIORITY_RANK: Record<string, number> = { owner: 5, c_level: 4, director: 3, manager: 2, ic: 1 };
