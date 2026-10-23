/* eslint-disable @typescript-eslint/no-require-imports -- Node build entry point. */
const { spawnSync } = require('node:child_process');
const { cpSync, existsSync, readdirSync, rmSync } = require('node:fs');
const { resolve, relative, dirname } = require('node:path');

// Explicit generation also supports hosts that restrict dependency lifecycle scripts.
const prismaBin = resolve(dirname(require.resolve('prisma/package.json')), 'build/index.js');
for (const [script, args] of [[prismaBin, ['generate']], [require.resolve('next/dist/bin/next'), ['build', ...process.argv.slice(2)]]]) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const root = process.cwd();
const dist = resolve(process.env.NEXT_DIST_DIR || '.next');
const distName = relative(root, dist);
if (distName.startsWith('..')) throw new Error('The build directory must be inside the project.');
const standalone = resolve(dist, 'standalone');
if (!existsSync(resolve(standalone, 'server.js'))) throw new Error('Standalone server was not generated.');
if (existsSync('public')) cpSync('public', resolve(standalone, 'public'), { recursive: true });
cpSync(resolve(dist, 'static'), resolve(standalone, distName, 'static'), { recursive: true });
// Next traces dotenv into standalone output. Runtime secrets belong to the hosting environment.
for (const name of readdirSync(standalone)) if (/^\.env(?:\.|$)/.test(name)) rmSync(resolve(standalone, name));
console.log('Standalone release packaged with public/static assets and without dotenv files.');
