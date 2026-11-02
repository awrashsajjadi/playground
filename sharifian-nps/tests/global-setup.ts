import { buildClient } from '../scripts/build-client.ts';

// Integration tests render pages that reference the hashed client bundles, so build them once.
export default async function setup(): Promise<void> {
  await buildClient();
}
