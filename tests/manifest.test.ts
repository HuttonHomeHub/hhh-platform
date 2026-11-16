import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MANIFEST_FILE,
  diffManifest,
  hashTree,
  isClean,
  listFiles,
  sha256,
} from '../scripts/lib/manifest.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hhh-manifest-'));
  await mkdir(join(dir, 'a', 'b'), { recursive: true });
  await writeFile(join(dir, 'a', 'b', 'two.txt'), 'two');
  await writeFile(join(dir, 'one.txt'), 'one');
  await writeFile(join(dir, MANIFEST_FILE), '{}');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('manifest', () => {
  it('lists files as sorted POSIX paths', async () => {
    expect(await listFiles(dir)).toEqual(['a/b/two.txt', 'manifest.json', 'one.txt']);
  });

  it('hashes every file except the manifest itself', async () => {
    expect(await hashTree(dir)).toEqual({ 'a/b/two.txt': sha256('two'), 'one.txt': sha256('one') });
  });

  it('reports changed, missing and extra files', () => {
    const diff = diffManifest({ a: '1', b: '2', c: '3' }, { a: '1', b: 'X', d: '4' });
    expect(diff).toEqual({ changed: ['b'], missing: ['c'], extra: ['d'] });
    expect(isClean(diff)).toBe(false);
    expect(isClean(diffManifest({ a: '1' }, { a: '1' }))).toBe(true);
  });
});
