// Re-export shim — actual implementation lives in src/helpers/emailChain.ts
// and is compiled to dist/helpers/emailChain.js. Kept at this path so user
// task plugins that import '../helpers/emailChain.mjs' continue to work.
import { pathToFileURL } from 'url';
import { runCli } from '../dist/helpers/emailChain.js';
export * from '../dist/helpers/emailChain.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2));
}
