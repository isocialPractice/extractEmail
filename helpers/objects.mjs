// Re-export shim — actual implementation lives in src/helpers/objects.ts
// and is compiled to dist/helpers/objects.js. Kept at this path so user
// task plugins that import '../helpers/objects.mjs' continue to work.
import { pathToFileURL } from 'url';
import { runCli } from '../dist/helpers/objects.js';
export * from '../dist/helpers/objects.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2));
}
