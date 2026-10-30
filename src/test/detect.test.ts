import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { detectStack, matchRules, recommend } from '../core/detect';
import type { CatalogEntry } from '../core/types';

let root: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'detect-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^19', next: '15' }, devDependencies: { typescript: '5', vitest: '2' } }));
  await fs.mkdir(path.join(root, 'api'));
  await fs.writeFile(path.join(root, 'api', 'pyproject.toml'), `[project]\nname = "x"\ndependencies = ["fastapi>=0.110", "SQLAlchemy[asyncio]"]\n[project.optional-dependencies]\ndev = ["pytest"]\n[tool.poetry.dependencies]\npython = "^3.11"\npydantic-settings = "^2"\n`);
  await fs.writeFile(path.join(root, 'api', 'requirements.txt'), `Django==5.0 # web\n-r other.txt\npsycopg[binary]\n`);
  await fs.mkdir(path.join(root, 'svc'));
  await fs.writeFile(path.join(root, 'svc', 'go.mod'), `module example.com/svc\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgithub.com/jackc/pgx/v5 v5.5.0\n)\n`);
  await fs.writeFile(path.join(root, 'Cargo.toml'), `[package]\nname = "a"\n[dependencies]\ntokio = { version = "1", features = ["full"] }\nserde = "1"\n[dev-dependencies]\ncriterion = "0.5"\n`);
  await fs.writeFile(path.join(root, 'pom.xml'), `<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId></parent><dependencies><dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency></dependencies></project>`);
  await fs.writeFile(path.join(root, 'Gemfile'), `source "https://rubygems.org"\ngem "rails", "~> 7.1"\ngem 'pg'\n`);
  await fs.writeFile(path.join(root, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11' } }));
  await fs.writeFile(path.join(root, 'App.csproj'), `<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Npgsql" Version="8" /></ItemGroup></Project>`);
  await fs.writeFile(path.join(root, 'pubspec.yaml'), `name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  go_router: ^13.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n`);
  await fs.mkdir(path.join(root, 'src', 'deep', 'deeper'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'deep', 'deeper', 'main.tsx'), 'export {}');
  await fs.mkdir(path.join(root, 'node_modules', 'evil'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules', 'evil', 'package.json'), JSON.stringify({ dependencies: { 'should-not-appear': '1' } }));
  await fs.writeFile(path.join(root, 'node_modules', 'evil', 'x.rb'), '');
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('detects dependencies across ecosystems and ignores node_modules', async () => {
  const stack = await detectStack(root);
  assert.ok(stack.npm.has('react'));
  assert.ok(stack.npm.has('vitest'));
  assert.ok(!stack.npm.has('should-not-appear'));
  assert.ok(stack.pip.has('fastapi'));
  assert.ok(stack.pip.has('sqlalchemy'));
  assert.ok(stack.pip.has('pytest'));
  assert.ok(stack.pip.has('pydantic-settings'));
  assert.ok(stack.pip.has('django'));
  assert.ok(stack.pip.has('psycopg'));
  assert.ok(!stack.pip.has('python'));
  assert.ok(stack.go.has('github.com/gin-gonic/gin'));
  assert.ok(stack.go.has('github.com/jackc/pgx/v5'));
  assert.ok(stack.cargo.has('tokio'));
  assert.ok(stack.cargo.has('criterion'));
  assert.ok(stack.jvm.has('org.springframework.boot'));
  assert.ok(stack.jvm.has('org.postgresql:postgresql'));
  assert.ok(stack.gem.has('rails'));
  assert.ok(stack.gem.has('pg'));
  assert.ok(stack.composer.has('laravel/framework'));
  assert.ok(stack.nuget.has('npgsql'));
  assert.ok(stack.nuget.has('microsoft.net.sdk.web'));
  assert.ok(stack.pub.has('flutter'));
  assert.ok(stack.pub.has('go_router'));
  assert.ok(stack.files.has('Cargo.toml'));
  assert.ok(stack.extensions.has('.tsx'));
  assert.ok(!stack.extensions.has('.rb'));
});

test('matchRules supports globs, prefixes and normalisation', async () => {
  const stack = await detectStack(root);
  assert.deepEqual(matchRules({ files: ['*.csproj'] }, stack), ['file: *.csproj']);
  assert.deepEqual(matchRules({ go: ['github.com/jackc/pgx'] }, stack), ['go: github.com/jackc/pgx']);
  assert.deepEqual(matchRules({ pip: ['SQLAlchemy'] }, stack), ['pip: sqlalchemy']);
  assert.deepEqual(matchRules({ npm: ['vue'] }, stack), []);
  assert.deepEqual(matchRules(undefined, stack), []);
});

test('recommend ranks dependency matches above extension matches', async () => {
  const stack = await detectStack(root);
  const entry = (id: string, detect: CatalogEntry['detect']): CatalogEntry => ({ id, name: id, description: '', category: 'languages', dir: id, version: '1', detect });
  const recs = recommend([entry('ts-only-ext', { extensions: ['.tsx'] }), entry('react', { npm: ['react'], extensions: ['.tsx'] }), entry('vue', { npm: ['vue'] })], stack);
  assert.deepEqual(recs.map((r) => r.entry.id), ['react', 'ts-only-ext']);
  assert.deepEqual(recs[0].reasons, ['npm: react', 'files with .tsx']);
});

test('records shallow directories so rules can match .github/workflows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'detect-dirs-'));
  try {
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, '.github', 'workflows', 'ci.yml'), 'on: push');
    const stack = await detectStack(dir);
    assert.ok(stack.files.has('.github/workflows'));
    assert.ok(stack.files.has('ci.yml'));
    assert.deepEqual(matchRules({ files: ['.github/workflows'] }, stack), ['file: .github/workflows']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
