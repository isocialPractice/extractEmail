// Re-export shim — actual implementation lives in src/helpers/narrowRequestedData.ts
// and is compiled to dist/helpers/narrowRequestedData.js. Kept at this path so user
// task plugins and scripts that reference '../helpers/narrowRequestedData.js' continue to work.
import { pathToFileURL } from 'url';
import { runCli } from '../dist/helpers/narrowRequestedData.js';
export * from '../dist/helpers/narrowRequestedData.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2));
}
