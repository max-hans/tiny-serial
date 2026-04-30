'use strict'

const path = require('path')
const fs = require('fs')

// Skip when running inside the package's own dev environment (not installed as a dependency)
const pkgDir = path.resolve(__dirname, '..')
const installPrefix = path.resolve(process.env.npm_config_local_prefix || '')
if (pkgDir === installPrefix) process.exit(0)

function detectPlatformId() {
  const platform = process.platform
  const arch = process.arch
  if (platform !== 'linux') return `${platform}-${arch}`

  // Detect musl (Alpine Linux) vs glibc
  let libc = 'gnu'
  try {
    if (fs.existsSync('/etc/alpine-release')) {
      libc = 'musl'
    } else {
      const { execSync } = require('child_process')
      try {
        const out = execSync('ldd --version 2>&1', { encoding: 'utf8' })
        if (out.toLowerCase().includes('musl')) libc = 'musl'
      } catch (e) {
        const msg = ((e.stdout || '') + (e.stderr || '')).toLowerCase()
        if (msg.includes('musl')) libc = 'musl'
      }
    }
  } catch {}

  return `${platform}-${arch}-${libc}`
}

try {
  require('../index.js')
} catch (e) {
  if (!e.message?.includes('Cannot find native binding')) process.exit(0)

  const platformId = detectPlatformId()
  console.warn(`
tiny-serial: No pre-built binary for ${platformId}.

If you expected a pre-built binary, try reinstalling:
  npm install   (or: bun install)

To build from source (requires Rust):
  1. Install Rust: https://rustup.rs
  2. Run inside node_modules/tiny-serial: npx napi build --platform --release

File an issue: https://github.com/max-hans/tiny-serial/issues
`)
}
