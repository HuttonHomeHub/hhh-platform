// Builds the release bundle the apps vendor: dist-release/hhh-platform-<version>.tgz
// plus its .sha256. The bundle holds each package's published files (from its
// package.json "files"), scripts/vendor.ts and its helpers, VERSION and manifest.json.
// Output is reproducible: sorted entries, fixed mtimes and owners, gzip without a timestamp.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_FILE, hashTree, sha256, type Manifest } from './lib/manifest.ts';

export const BUNDLE_DIR = 'hhh-platform';

export interface PackResult {
  version: string;
  tarball: string;
  checksumFile: string;
  sha256: string;
}

interface PackageJson {
  name: string;
  version: string;
  files?: string[];
  [key: string]: unknown;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export function tarballName(version: string): string {
  return `hhh-platform-${version}.tgz`;
}

export async function packRelease(root: string, outDir: string): Promise<PackResult> {
  const { version } = await readJson<PackageJson>(join(root, 'package.json'));
  const staging = await mkdtemp(join(tmpdir(), 'hhh-pack-'));
  try {
    const bundle = join(staging, BUNDLE_DIR);
    for (const pkg of (await readdir(join(root, 'packages'))).sort()) {
      const src = join(root, 'packages', pkg);
      const meta = await readJson<PackageJson>(join(src, 'package.json'));
      const dest = join(bundle, 'packages', pkg);
      await mkdir(dest, { recursive: true });
      for (const entry of meta.files ?? []) {
        await cp(join(src, entry), join(dest, entry), { recursive: true }).catch((err: unknown) => {
          throw new Error(`${meta.name}: "${entry}" is missing (build it first: npm run build)`, {
            cause: err,
          });
        });
      }
      // Packages are released together, so each carries the platform's version.
      await writeFile(
        join(dest, 'package.json'),
        `${JSON.stringify({ ...meta, version }, null, 2)}\n`
      );
    }
    await cp(join(root, 'scripts', 'vendor.ts'), join(bundle, 'scripts', 'vendor.ts'));
    await cp(join(root, 'scripts', 'lib'), join(bundle, 'scripts', 'lib'), { recursive: true });
    await writeFile(join(bundle, 'VERSION'), `${version}\n`);
    const manifest: Manifest = { version, files: await hashTree(bundle) };
    await writeFile(join(bundle, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

    await mkdir(outDir, { recursive: true });
    const tarball = join(outDir, tarballName(version));
    const tar = spawnSync(
      'tar',
      [
        '--sort=name',
        '--mtime=@0',
        '--owner=0',
        '--group=0',
        '--numeric-owner',
        '--use-compress-program=gzip -n',
        '-C',
        staging,
        '-cf',
        tarball,
        BUNDLE_DIR,
      ],
      { encoding: 'utf8' }
    );
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.error?.message}`);
    const hash = sha256(await readFile(tarball));
    const checksumFile = `${tarball}.sha256`;
    await writeFile(checksumFile, `${hash}  ${tarballName(version)}\n`);
    return { version, tarball, checksumFile, sha256: hash };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function main(): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await packRelease(root, join(root, 'dist-release'));
  console.warn(
    `packed hhh-platform ${result.version}: ${result.tarball} (sha256 ${result.sha256})`
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
