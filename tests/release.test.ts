import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../scripts/lib/manifest.ts';
import { packRelease, tarballName } from '../scripts/pack-release.ts';
import { installRelease, main, releaseUrls, verifyVendor } from '../scripts/vendor.ts';

const root = resolve(import.meta.dirname, '..');
let work: string;
let tgz: Buffer;
let checksum: string;
let version: string;

// A fetch that serves the freshly packed bundle as if it were the GitHub release.
function fakeFetch(files: Record<string, Buffer | string>) {
  return async (url: string) => {
    const body = files[url];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      arrayBuffer: async () => {
        const buf = Buffer.from(body ?? '');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
    };
  };
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'hhh-release-'));
  const packed = await packRelease(root, join(work, 'out'));
  version = packed.version;
  tgz = await readFile(packed.tarball);
  checksum = await readFile(packed.checksumFile, 'utf8');
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('packRelease', () => {
  it('writes the bundle and a matching checksum file', () => {
    expect(checksum).toBe(`${sha256(tgz)}  ${tarballName(version)}\n`);
  });

  it('is reproducible: packing twice gives the same bytes', async () => {
    const again = await packRelease(root, join(work, 'again'));
    expect(sha256(await readFile(again.tarball))).toBe(sha256(tgz));
  });

  it('contains the packages, the vendor script and a clean manifest', async () => {
    const out = join(work, 'unpacked');
    await rm(out, { recursive: true, force: true });
    spawnSync('mkdir', ['-p', out]);
    expect(
      spawnSync('tar', ['-xzf', join(work, 'out', tarballName(version)), '-C', out]).status
    ).toBe(0);
    const bundle = join(out, 'hhh-platform');
    const { version: v, diff } = await verifyVendor(bundle);
    expect(v).toBe(version);
    expect(diff).toEqual({ changed: [], missing: [], extra: [] });
    const pkg = JSON.parse(await readFile(join(bundle, 'packages/config/package.json'), 'utf8'));
    expect(pkg.version).toBe(version);
    expect((await readFile(join(bundle, 'VERSION'), 'utf8')).trim()).toBe(version);
    expect(await readFile(join(bundle, 'scripts/vendor.ts'), 'utf8')).toContain('installRelease');
  });
});

describe('vendor', () => {
  const urls = () => releaseUrls(version);

  it('installs a release whose checksum and manifest match, then --check passes', async () => {
    // A fresh app: vendor/ does not exist yet.
    const dest = join(work, 'app', 'vendor', 'hhh-platform');
    const fetchImpl = fakeFetch({ [urls().tarball]: tgz, [urls().checksum]: checksum });
    expect(await main([version], dest, fetchImpl)).toBe(0);
    expect(await main(['--check'], dest)).toBe(0);

    await writeFile(join(dest, 'packages/config/prettier.js'), '// edited by hand\n');
    await unlink(join(dest, 'VERSION'));
    await writeFile(join(dest, 'stray.txt'), 'x');
    expect(await main(['--check'], dest)).toBe(1);
    expect((await verifyVendor(dest)).diff).toEqual({
      changed: ['packages/config/prettier.js'],
      missing: ['VERSION'],
      extra: ['stray.txt'],
    });

    // Installing again replaces the edited copy with the released one.
    expect(await main([version], dest, fetchImpl)).toBe(0);
    expect(await main(['--check'], dest)).toBe(0);
  });

  it('refuses a bundle whose checksum does not match the release', async () => {
    const dest = join(work, 'bad', 'hhh-platform');
    const fetchImpl = fakeFetch({
      [urls().tarball]: tgz,
      [urls().checksum]: `${'0'.repeat(64)}  x\n`,
    });
    await expect(installRelease(version, dest, fetchImpl)).rejects.toThrow('checksum');
  });

  it('refuses a version the bundle is not', async () => {
    const other = '9.9.9';
    const u = releaseUrls(other);
    const fetchImpl = fakeFetch({ [u.tarball]: tgz, [u.checksum]: checksum });
    await expect(installRelease(other, join(work, 'x', 'hhh-platform'), fetchImpl)).rejects.toThrow(
      `bundle is ${version}`
    );
  });

  it('reports a missing release and bad arguments', async () => {
    await expect(installRelease('1.2.3', join(work, 'y'), fakeFetch({}))).rejects.toThrow('404');
    await expect(installRelease('latest', join(work, 'y'), fakeFetch({}))).rejects.toThrow('X.Y.Z');
    expect(await main(['latest'], join(work, 'y'))).toBe(2);
  });
});
