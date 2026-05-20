// Output utilities: resolve output path option, prepare writer, and write lines
// either to stdout or to a response file. The writer state is a module-level
// singleton intentionally shared across the application.

import fs from 'fs';
import path from 'path';

export const DEFAULT_RESPONSE_FILENAME = 'extractEmal.response.txt';

export const outputWriter: { enabled: boolean; filePath: string | null; initialized: boolean } = {
  enabled: false,
  filePath: null,
  initialized: false
};

export const resolveOutputOption = (rawPath) => {
  if (!rawPath) return null;
  const resolvedPath = path.resolve(process.cwd(), rawPath);
  const hasTrailingSep = rawPath.endsWith(path.sep) || rawPath.endsWith('/') || rawPath.endsWith('\\');

  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    return {
      type: stat.isDirectory() ? 'directory' : 'file',
      path: resolvedPath
    };
  }

  if (hasTrailingSep) {
    return { type: 'directory', path: resolvedPath };
  }

  if (path.extname(resolvedPath)) {
    return { type: 'file', path: resolvedPath };
  }

  return { type: 'directory', path: resolvedPath };
};

export const prepareOutputWriter = (outputOption, isTaskMode) => {
  if (!outputOption || isTaskMode) return;

  if (outputOption.type === 'file' && fs.existsSync(outputOption.path)) {
    throw new Error(`Output file already exists: ${outputOption.path}`);
  }

  const targetFilePath = outputOption.type === 'file'
    ? outputOption.path
    : path.join(outputOption.path, DEFAULT_RESPONSE_FILENAME);

  outputWriter.enabled = true;
  outputWriter.filePath = targetFilePath;
  outputWriter.initialized = false;
};

export const writeOutputLine = (line) => {
  if (!outputWriter.enabled) {
    console.log(line);
    return;
  }

  if (!outputWriter.initialized) {
    const dir = path.dirname(outputWriter.filePath!);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputWriter.filePath!, '');
    outputWriter.initialized = true;
  }

  fs.appendFileSync(outputWriter.filePath!, `${line}\n`);
};
