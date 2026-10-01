#!/usr/bin/env node
/** Content-cached production build. No external build tooling required. */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flags = new Set(process.argv.slice(2))
const allowed = ['--force', '--ci', '--web-only', '--help']
if ([...flags].some(flag => !allowed.includes(flag))) throw new Error(`Supported flags: ${allowed.join(', ')}`)
if (flags.has('--help')) {
  console.log('node scripts/build.mjs [--force] [--ci] [--web-only]\nBuild web + edge concurrently, install missing/changed dependencies, and reuse unchanged output.\n--force: rebuild outputs\n--ci: clean dependency installs and rebuild\n--web-only: build web only (PR previews still install Wrangler)')
  process.exit(0)
}
const cacheDir = join(root, '.cache', 'build')
await mkdir(cacheDir, { recursive: true })
function run(args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('npm', args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`${args.join(' ')} failed (${code})`)))
  })
}
async function fingerprint(paths) {
  const hash = createHash('sha256').update(process.version)
  hash.update(JSON.stringify(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_') || key === 'NODE_ENV').sort(([a], [b]) => a.localeCompare(b))))
  async function visit(path) {
    const full = join(root, path)
    if (!existsSync(full)) { hash.update(`missing:${path}`); return }
    const info = await stat(full)
    if (info.isDirectory()) {
      for (const entry of (await readdir(full)).sort()) await visit(join(path, entry))
    } else { hash.update(path); hash.update(await readFile(full)) }
  }
  for (const path of paths) await visit(path)
  return hash.digest('hex')
}
const targets = {
  web: { inputs: ['web/src', 'web/public', 'web/index.html', 'web/vite.config.ts', 'web/tsconfig.json', 'web/package.json', 'web/package-lock.json', 'scripts/build.mjs'], outputs: ['web/dist/index.html', 'web/dist/assets'] },
  edge: { inputs: ['edge/src', 'edge/tsconfig.json', 'edge/tsconfig.node.json', 'edge/package.json', 'edge/package-lock.json', 'scripts/build.mjs'], outputs: ['edge/dist/node.js', 'edge/dist/service.js'] },
}
async function build(name) {
  const started = performance.now()
  const cwd = join(root, name)
  const cacheFile = join(cacheDir, `${name}.json`)
  const cached = await readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => ({}))
  const lock = await fingerprint([`${name}/package.json`, `${name}/package-lock.json`])
  const dependenciesMissing = !existsSync(join(cwd, 'node_modules', '.package-lock.json'))
  if (flags.has('--ci') || dependenciesMissing || (cached.lock && cached.lock !== lock)) await run(['ci', '--no-audit', '--no-fund'], cwd)
  if (name === 'edge' && flags.has('--web-only')) {
    await writeFile(cacheFile, JSON.stringify({ ...cached, lock }))
    console.log('[edge] Wrangler dependencies ready')
    return
  }
  const digest = await fingerprint(targets[name].inputs)
  const outputPresent = targets[name].outputs.every(output => existsSync(join(root, output)))
  const outputDigest = outputPresent ? await fingerprint([`${name}/dist`]) : ''
  if (!flags.has('--force') && !flags.has('--ci') && !dependenciesMissing && cached.digest === digest && outputPresent && cached.outputDigest === outputDigest) console.log(`[${name}] unchanged — using existing output`)
  else {
    await run(['run', 'build'], cwd)
    await writeFile(cacheFile, JSON.stringify({ digest, lock, outputDigest: await fingerprint([`${name}/dist`]) }))
    console.log(`[${name}] built in ${((performance.now() - started) / 1000).toFixed(2)}s`)
  }
}
const started = performance.now()
const results = await Promise.allSettled(Object.keys(targets).map(build))
const failed = results.filter(result => result.status === 'rejected')
if (failed.length) {
  for (const result of failed) console.error(result.reason.message)
  process.exitCode = 1
} else console.log(`Build ready in ${((performance.now() - started) / 1000).toFixed(2)}s: web/dist${flags.has('--web-only') ? '' : ' + edge/dist'}`)
