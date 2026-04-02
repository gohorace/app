import * as esbuild from 'esbuild'
import { gzipSync } from 'zlib'
import { readFileSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_PUBLIC = resolve(__dirname, '../web/public')

const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['src/tracker.ts'],
  bundle: true,
  minify: true,
  target: 'es2017',
  format: 'iife',
  outfile: 'dist/tracker.min.js',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})

if (watch) {
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await ctx.rebuild()
  await ctx.dispose()

  const raw = readFileSync('dist/tracker.min.js')
  const gzipped = gzipSync(raw)
  console.log(
    `Built: ${raw.length} bytes raw, ${gzipped.length} bytes gzipped (target: <3072)`,
  )
  if (gzipped.length > 3072) {
    console.warn('WARNING: Bundle exceeds 3KB gzipped target')
  }

  // Copy to web/public for local dev serving
  if (!existsSync(WEB_PUBLIC)) mkdirSync(WEB_PUBLIC, { recursive: true })
  copyFileSync('dist/tracker.min.js', resolve(WEB_PUBLIC, 'tracker.min.js'))
  console.log(`Copied to apps/web/public/tracker.min.js`)
}
