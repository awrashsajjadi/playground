// Bundles browser TypeScript (src/client/*.ts) into public/build/*.js with esbuild.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

export const CLIENT_ENTRIES = ['form', 'admin', 'dashboard'] as const;

// The customer form must run on older phones (Chrome 64+, iOS 13+); admin pages (Chart.js) target modern browsers.
const TARGETS: Record<(typeof CLIENT_ENTRIES)[number], string[]> = {
  form: ['es2018', 'chrome64', 'safari13', 'firefox78'],
  admin: ['es2020'],
  dashboard: ['es2020'],
};

export async function buildClient(options: { minify?: boolean } = {}): Promise<void> {
  await Promise.all(
    CLIENT_ENTRIES.map(async (name) => {
      const file = `${root}src/client/${name}.ts`;
      if (!existsSync(file)) return;
      await build({
        entryPoints: { [name]: file },
        outdir: `${root}public/build`,
        bundle: true,
        minify: options.minify ?? true,
        format: 'iife',
        target: TARGETS[name],
        charset: 'utf8',
        legalComments: 'none',
        logLevel: 'warning',
      });
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildClient();
  console.log('client bundles built → public/build/');
}
