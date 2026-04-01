import { Bench } from 'tinybench'

import { ReadlineParser, ByteLengthParser, RegexParser } from '../serial.js'
import { ReadlineParser as SpReadlineParser } from '@serialport/parser-readline'
import { ByteLengthParser as SpByteLengthParser } from '@serialport/parser-byte-length'
import { RegexParser as SpRegexParser } from '@serialport/parser-regex'

// Synthetic data: 100 newline-delimited lines of 64 bytes each
const LINE = Buffer.alloc(63, 0x41) // 63 x 'A'
const NEWLINE = Buffer.from('\n')
const CHUNK_READLINE = Buffer.concat(
  Array.from({ length: 100 }, () => Buffer.concat([LINE, NEWLINE])),
)

// Synthetic data: 1000 bytes for ByteLengthParser (packet size 8)
const CHUNK_BYTELENGTH = Buffer.alloc(1000, 0x42)

const b = new Bench({ iterations: 500 })

// --- ReadlineParser ---
b.add('bun-serial  ReadlineParser — 100 lines × 64 B', () => {
  const parser = new ReadlineParser()
  parser.on('data', () => {})
  parser.write(CHUNK_READLINE)
})

b.add('serialport  ReadlineParser — 100 lines × 64 B', () => {
  const parser = new SpReadlineParser()
  parser.on('data', () => {})
  parser.write(CHUNK_READLINE)
})

// --- ByteLengthParser ---
b.add('bun-serial  ByteLengthParser — 1000 B / 8-byte packets', () => {
  const parser = new ByteLengthParser({ length: 8 })
  parser.on('data', () => {})
  parser.write(CHUNK_BYTELENGTH)
})

b.add('serialport  ByteLengthParser — 1000 B / 8-byte packets', () => {
  const parser = new SpByteLengthParser({ length: 8 })
  parser.on('data', () => {})
  parser.write(CHUNK_BYTELENGTH)
})

// --- RegexParser ---
b.add('bun-serial  RegexParser — 100 lines × 64 B', () => {
  const parser = new RegexParser({ regex: /[^\n]+\n/ })
  parser.on('data', () => {})
  parser.write(CHUNK_READLINE)
})

b.add('serialport  RegexParser — 100 lines × 64 B', () => {
  const parser = new SpRegexParser({ regex: /[^\n]+\n/ })
  parser.on('data', () => {})
  parser.write(CHUNK_READLINE)
})

await b.run()

console.table(b.table())
