#!/usr/bin/env node
// Runs the compiled CLI when it exists, otherwise falls back to tsx for source checkouts.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const built = path.join(root, 'dist', 'cli', 'index.js')

if (existsSync(built)) {
  await import(built)
} else {
  const child = spawn(
    process.execPath,
    [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'src', 'cli', 'index.ts'), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  child.on('close', (code) => process.exit(code ?? 0))
}
