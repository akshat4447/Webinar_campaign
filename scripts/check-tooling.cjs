/* eslint-disable @typescript-eslint/no-require-imports -- Install guard runs through Node CommonJS. */
const {readFileSync} = require('node:fs');
const {dirname,join} = require('node:path');
const {createRequire} = require('node:module');
const pluginManifest = require.resolve('@next/eslint-plugin-next/package.json');
const plugin = JSON.parse(readFileSync(pluginManifest,'utf8'));
if (plugin.version !== '16.4.0') throw new Error('Review the directory-glob compatibility package before updating the Next ESLint plugin.');
const pluginRequire = createRequire(pluginManifest);
const glob = pluginRequire('fast-glob');
if (typeof glob.globSync !== 'function') throw new Error('Next lint requires the globSync directory API.');
const source = readFileSync(join(dirname(pluginManifest),'dist/utils/get-root-dirs.js'),'utf8');
if (!source.includes('onlyDirectories: true') || !source.includes('.globSync)')) throw new Error('Next lint directory-discovery contract changed; review the glob compatibility package.');
console.log('Next lint directory-glob compatibility guard passed.');
