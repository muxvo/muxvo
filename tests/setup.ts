import path from 'path';
import fs from 'fs';
import Module from 'module';
import { transformSync } from 'esbuild';

// Patch require to resolve @/ aliases (same as vitest alias config)
const srcRoot = path.resolve(__dirname, '..', 'src');
const originalResolveFilename = (Module as any)._resolveFilename;

(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any,
) {
  if (request.startsWith('@/')) {
    const resolved = path.join(srcRoot, request.slice(2));
    if (!path.extname(resolved)) {
      const tsPath = resolved + '.ts';
      if (fs.existsSync(tsPath)) {
        request = tsPath;
      } else {
        request = resolved;
      }
    } else {
      request = resolved;
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Register .ts extension handler using esbuild for require() calls
const originalTsHandler = (Module as any)._extensions['.ts'];
(Module as any)._extensions['.ts'] = function (mod: any, filename: string) {
  // If vitest already registered a handler, try it first
  if (originalTsHandler) {
    try {
      return originalTsHandler(mod, filename);
    } catch {
      // Fall through to esbuild
    }
  }

  const content = fs.readFileSync(filename, 'utf8');
  const { code } = transformSync(content, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2022',
    sourcefile: filename,
  });
  (mod as any)._compile(code, filename);
};
