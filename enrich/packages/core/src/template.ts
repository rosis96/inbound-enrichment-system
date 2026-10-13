const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\|([^}]*))?\}\}/g;

export type TemplateValues = Record<string, string | number | null | undefined>;

/**
 * Fills `{{name}}` placeholders. `{{name|fallback}}` uses the fallback when the value is
 * missing or blank; a missing value without a fallback renders as an empty string.
 */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(PLACEHOLDER, (_match, name: string, fallback: string | undefined) => {
    const value = values[name];
    const text = value === null || value === undefined ? "" : String(value).trim();
    return text !== "" ? text : (fallback ?? "").trim();
  });
}

/** Placeholder names used in a template, e.g. to warn about unknown ones. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]!))];
}
