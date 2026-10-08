/* eslint-disable @typescript-eslint/no-require-imports -- Next loads this compatibility module through CommonJS. */
const { globSync: tinyGlobSync } = require('tinyglobby');
const path = require('node:path');

// Next's plugin uses only globSync(pattern, {onlyDirectories:true}). Preserve
// fast-glob's absolute-pattern output and unmarked-directory conventions.
exports.globSync = function globSync(pattern, options = {}) {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const absolute = options.absolute ?? patterns.some(value => path.isAbsolute(value));
  return tinyGlobSync(pattern, { ...options, absolute }).map(value => value.length > 1 ? value.replace(/\/$/, '') : value);
};
