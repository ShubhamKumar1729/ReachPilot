/**
 * buildQuery — merges optional advanced settings into a role's base LinkedIn
 * posts-search query using REAL LinkedIn search operators:
 *   - must-contain keywords / locations / companies → AND ("a" OR "b")
 *   - exclude keywords / companies                  → -term / -"phrase"
 *
 * Everything is optional: with no advanced settings the base query is
 * returned unchanged (existing behavior preserved exactly).
 */

export interface AdvancedSearch {
  includeKeywords?: string; // comma separated
  excludeKeywords?: string;
  locations?: string; // free text, comma separated (searched as terms)
  companies?: string;
  excludeCompanies?: string;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function quotedGroup(terms: string[]): string {
  return `AND (${terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ")})`;
}

function excludeTerm(t: string): string {
  const clean = t.replace(/"/g, "");
  return clean.includes(" ") ? `-"${clean}"` : `-${clean}`;
}

export function buildQuery(baseQuery: string, adv: AdvancedSearch): string {
  let q = baseQuery.trim();
  if (!q) return "";

  const include = splitList(adv.includeKeywords);
  if (include.length > 0) q += ` ${quotedGroup(include)}`;

  const locs = splitList(adv.locations);
  if (locs.length > 0) q += ` ${quotedGroup(locs)}`;

  const comps = splitList(adv.companies);
  if (comps.length > 0) q += ` ${quotedGroup(comps)}`;

  const excludes = [
    ...splitList(adv.excludeKeywords),
    ...splitList(adv.excludeCompanies),
  ];
  for (const e of excludes) q += ` ${excludeTerm(e)}`;

  return q.slice(0, 500);
}
