import * as esbuild from 'esbuild'
import { gzipSync } from 'zlib'
import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_PUBLIC = resolve(__dirname, '../web/public')

const watch = process.argv.includes('--watch')

// Two IIFE bundles served as static assets from apps/web/public:
//   tracker.min.js — first-party analytics
//   embed.min.js   — Doorstep website capture form (HOR-283)
const TARGETS = [
  { entry: 'src/tracker.ts', out: 'tracker.min.js', gzipBudget: 3072 },
  { entry: 'src/embed.ts', out: 'embed.min.js', gzipBudget: 6144 },
]

if (!existsSync(WEB_PUBLIC)) mkdirSync(WEB_PUBLIC, { recursive: true })

for (const target of TARGETS) {
  const ctx = await esbuild.context({
    entryPoints: [target.entry],
    bundle: true,
    minify: true,
    target: 'es2017',
    format: 'iife',
    outfile: `dist/${target.out}`,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  })

  if (watch) {
    await ctx.watch()
    continue
  }

  await ctx.rebuild()
  await ctx.dispose()

  const raw = readFileSync(`dist/${target.out}`)
  const gzipped = gzipSync(raw)
  console.log(
    `Built ${target.out}: ${raw.length} bytes raw, ${gzipped.length} bytes gzipped (target: <${target.gzipBudget})`,
  )
  if (gzipped.length > target.gzipBudget) {
    console.warn(`WARNING: ${target.out} exceeds ${target.gzipBudget} bytes gzipped`)
  }

  // Copy to web/public for local dev serving
  copyFileSync(`dist/${target.out}`, resolve(WEB_PUBLIC, target.out))
  console.log(`Copied to apps/web/public/${target.out}`)
}

if (watch) {
  console.log('Watching for changes...')
}
