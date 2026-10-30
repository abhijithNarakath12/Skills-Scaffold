import * as fs from 'fs/promises';
import * as path from 'path';
import type { Catalog, CatalogEntry, SkillCategory } from './types';

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  generic: 'Engineering Workflows',
  languages: 'Languages',
  frameworks: 'Frameworks',
  libraries: 'Libraries',
  tooling: 'Tooling & Infrastructure',
};

export const CATEGORY_ORDER: SkillCategory[] = ['generic', 'languages', 'frameworks', 'libraries', 'tooling'];

/** Loads the generated catalog from the extension's `skills/` directory. */
export async function loadCatalog(skillsRoot: string): Promise<Catalog> {
  const file = path.join(skillsRoot, 'catalog.json');
  const text = await fs.readFile(file, 'utf8');
  const catalog = JSON.parse(text) as Catalog;
  catalog.skills.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.id.localeCompare(b.id));
  return catalog;
}

export function groupByCategory(entries: CatalogEntry[]): Map<SkillCategory, CatalogEntry[]> {
  const map = new Map<SkillCategory, CatalogEntry[]>();
  for (const cat of CATEGORY_ORDER) {
    map.set(cat, []);
  }
  for (const e of entries) {
    map.get(e.category)?.push(e);
  }
  return map;
}

/** Simple case-insensitive search over id, name, description and tags. */
export function searchCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return entries;
  }
  return entries.filter((e) =>
    [e.id, e.name, e.title ?? '', e.description, ...(e.tags ?? [])].some((s) => s.toLowerCase().includes(q)),
  );
}

/** Expands a selection with its `recommends` dependencies (transitively, no duplicates). */
export function withRecommended(entries: CatalogEntry[], selected: string[]): string[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !byId.has(id)) {
      return;
    }
    seen.add(id);
    out.push(id);
    for (const dep of byId.get(id)!.recommends ?? []) {
      visit(dep);
    }
  };
  selected.forEach(visit);
  return out;
}
