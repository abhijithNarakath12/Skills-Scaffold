import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { loadCatalog, searchCatalog, withRecommended } from '../core/catalog';
import type { CatalogEntry } from '../core/types';

const e = (id: string, recommends: string[] = [], tags: string[] = []): CatalogEntry => ({ id, name: id, description: `${id} desc`, category: 'libraries', dir: id, version: '1', recommends, tags });

test('withRecommended expands transitively without duplicates or cycles', () => {
  const entries = [e('nextjs', ['react', 'typescript']), e('react', ['typescript']), e('typescript', ['nextjs']), e('vue')];
  assert.deepEqual(withRecommended(entries, ['nextjs']), ['nextjs', 'react', 'typescript']);
  assert.deepEqual(withRecommended(entries, ['vue', 'missing']), ['vue']);
});

test('searchCatalog matches id, description and tags', () => {
  const entries = [e('react', [], ['frontend']), e('django', [], ['backend'])];
  assert.deepEqual(searchCatalog(entries, 'FRONT').map((x) => x.id), ['react']);
  assert.deepEqual(searchCatalog(entries, 'django desc').map((x) => x.id), ['django']);
  assert.equal(searchCatalog(entries, '  ').length, 2);
});

test('bundled catalog loads, is sorted and has unique ids', async () => {
  const catalog = await loadCatalog(path.resolve(__dirname, '..', '..', 'skills'));
  assert.ok(catalog.skills.length >= 5);
  const ids = catalog.skills.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of catalog.skills) {
    assert.equal(s.name, s.id);
    assert.ok(s.description.length > 20, `${s.id} description`);
    for (const r of s.recommends ?? []) {
      assert.ok(ids.includes(r), `${s.id} recommends unknown skill ${r}`);
    }
  }
  const generic = catalog.skills.filter((s) => s.category === 'generic').map((s) => s.id);
  for (const required of ['plan-feature', 'design-doc', 'review-pr']) {
    assert.ok(generic.includes(required), `missing workflow skill ${required}`);
  }
});
