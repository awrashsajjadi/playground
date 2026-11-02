// Bundles browser TypeScript (src/client/*.ts) into public/build/*.js with esbuild.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

export const CLIENT_ENTRIES = ['form', 'admin', 'dashboard'] as const;

export async function buildClient(options: { minify?: boolean } = {}): Promise<void> {
  const entryPoints: Record<string, string> = {};
  for (const name of CLIENT_ENTRIES) {
    const file = `${root}src/client/${name}.ts`;
    if (existsSync(file)) entryPoints[name] = file;
  }
  await build({
    entryPoints,
    outdir: `${root}public/build`,
    bundle: true,
    minify: options.minify ?? true,
    format: 'iife',
    target: ['es2018', 'chrome64', 'safari13', 'firefox78'],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildClient();
  console.log('client bundles built → public/build/');
}
