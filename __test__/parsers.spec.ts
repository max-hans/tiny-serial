import { Readable } from 'node:stream'
import { test, expect } from 'bun:test'
import { ReadlineParser } from '../lib/parsers/ReadlineParser.js'
import { ByteLengthParser } from '../lib/parsers/ByteLengthParser.js'
import { InterByteTimeoutParser } from '../lib/parsers/InterByteTimeoutParser.js'
import { RegexParser } from '../lib/parsers/RegexParser.js'

// Helper: collect all emitted chunks from a readable pipe
function collect(readable: Readable): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    readable.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    readable.on('end', () => resolve(chunks))
    readable.on('error', reject)
  })
}

// ────────── ReadlineParser ──────────

test('ReadlineParser: splits multi-line chunk', async () => {
  const parser = new ReadlineParser({ delimiter: '\n' })
  const source = Readable.from([Buffer.from('hello\nworld\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['hello', 'world'])
})

test('ReadlineParser: reassembles lines from 1-byte chunks', async () => {
  const parser = new ReadlineParser({ delimiter: '\n' })
  const data = Buffer.from('foo\nbar\n')
  const source = Readable.from(Array.from(data).map((b) => Buffer.from([b])))
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['foo', 'bar'])
})

test('ReadlineParser: flushes remainder without trailing delimiter', async () => {
  const parser = new ReadlineParser({ delimiter: '\n' })
  const source = Readable.from([Buffer.from('hello')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['hello'])
})

test('ReadlineParser: supports multi-char delimiter', async () => {
  const parser = new ReadlineParser({ delimiter: '\r\n' })
  const source = Readable.from([Buffer.from('a\r\nb\r\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['a', 'b'])
})

test('ReadlineParser: throws on empty delimiter', () => {
  expect(() => new ReadlineParser({ delimiter: '' })).toThrow(TypeError)
})

test('ReadlineParser: default delimiter is newline', async () => {
  const parser = new ReadlineParser()
  const source = Readable.from([Buffer.from('a\nb\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['a', 'b'])
})

test('ReadlineParser: includeDelimiter appends delimiter to each line', async () => {
  const parser = new ReadlineParser({ delimiter: '\n', includeDelimiter: true })
  const source = Readable.from([Buffer.from('hello\nworld\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['hello\n', 'world\n'])
})

test('ReadlineParser: includeDelimiter with multi-char delimiter', async () => {
  const parser = new ReadlineParser({ delimiter: '\r\n', includeDelimiter: true })
  const source = Readable.from([Buffer.from('a\r\nb\r\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['a\r\n', 'b\r\n'])
})

test('ReadlineParser: remainder flushed without appending delimiter even when includeDelimiter is true', async () => {
  const parser = new ReadlineParser({ delimiter: '\n', includeDelimiter: true })
  const source = Readable.from([Buffer.from('partial')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['partial'])
})

// ────────── ByteLengthParser ──────────

test('ByteLengthParser: emits exact length packets', async () => {
  const parser = new ByteLengthParser({ length: 4 })
  const source = Readable.from([Buffer.from('abcdefgh')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['abcd', 'efgh'])
})

test('ByteLengthParser: holds remainder until flush', async () => {
  const parser = new ByteLengthParser({ length: 4 })
  const source = Readable.from([Buffer.from('abcde')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['abcd', 'e'])
})

test('ByteLengthParser: reassembles across multiple chunks', async () => {
  const parser = new ByteLengthParser({ length: 3 })
  const source = Readable.from([Buffer.from('ab'), Buffer.from('cd'), Buffer.from('ef')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['abc', 'def'])
})

test('ByteLengthParser: throws on length < 1', () => {
  expect(() => new ByteLengthParser({ length: 0 })).toThrow(TypeError)
})

test('ByteLengthParser: chunk exactly fills one packet with no remainder', async () => {
  const parser = new ByteLengthParser({ length: 5 })
  const source = Readable.from([Buffer.from('hello')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['hello'])
})

test('ByteLengthParser: single large chunk produces multiple complete packets', async () => {
  const parser = new ByteLengthParser({ length: 3 })
  const source = Readable.from([Buffer.from('abcdefghi')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['abc', 'def', 'ghi'])
})

// ────────── InterByteTimeoutParser ──────────

test('InterByteTimeoutParser: emits buffer after timeout', async () => {
  const parser = new InterByteTimeoutParser({ interval: 20 })
  const chunks: Buffer[] = []
  parser.on('data', (chunk: Buffer) => chunks.push(chunk))

  parser.write(Buffer.from('hello'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  parser.end()

  expect(chunks.length).toBe(1)
  expect(chunks[0].toString()).toBe('hello')
})

test('InterByteTimeoutParser: accumulates bytes within the interval', async () => {
  const parser = new InterByteTimeoutParser({ interval: 50 })
  const chunks: Buffer[] = []
  parser.on('data', (chunk: Buffer) => chunks.push(chunk))

  parser.write(Buffer.from('a'))
  await new Promise((resolve) => setTimeout(resolve, 10))
  parser.write(Buffer.from('b'))
  await new Promise((resolve) => setTimeout(resolve, 10))
  parser.write(Buffer.from('c'))
  await new Promise((resolve) => setTimeout(resolve, 100))
  parser.end()

  expect(chunks.length).toBe(1)
  expect(chunks[0].toString()).toBe('abc')
})

test('InterByteTimeoutParser: throws on interval < 1', () => {
  expect(() => new InterByteTimeoutParser({ interval: 0 })).toThrow(TypeError)
})

test('InterByteTimeoutParser: two bursts separated by timeout produce two emissions', async () => {
  const parser = new InterByteTimeoutParser({ interval: 30 })
  const chunks: Buffer[] = []
  parser.on('data', (chunk: Buffer) => chunks.push(chunk))

  parser.write(Buffer.from('first'))
  await new Promise((resolve) => setTimeout(resolve, 80))
  parser.write(Buffer.from('second'))
  await new Promise((resolve) => setTimeout(resolve, 80))
  parser.end()

  expect(chunks.length).toBe(2)
  expect(chunks[0].toString()).toBe('first')
  expect(chunks[1].toString()).toBe('second')
})

test('InterByteTimeoutParser: emits immediately when maxBufferSize is reached', async () => {
  const parser = new InterByteTimeoutParser({ interval: 5000, maxBufferSize: 4 })
  const chunks: Buffer[] = []
  parser.on('data', (chunk: Buffer) => chunks.push(chunk))

  parser.write(Buffer.from('hello'))
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(chunks.length).toBe(1)
  expect(chunks[0].toString()).toBe('hello')
})

// ────────── RegexParser (Functional Compatibility) ──────────

test('RegexParser: splits on regex matches and discards delimiter', async () => {
  const parser = new RegexParser({ regex: /\r\n/ })
  const source = Readable.from([Buffer.from('foo\r\nbar\r\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['foo', 'bar'])
})

test('RegexParser: handles multiple delimiters and ignores empty matches', async () => {
  const parser = new RegexParser({ regex: /OK|ERROR/ })
  const source = Readable.from([Buffer.from('firstOKsecondERROR')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['first', 'second'])
})

test('RegexParser: flushes remainder on end', async () => {
  const parser = new RegexParser({ regex: /\n/ })
  const source = Readable.from([Buffer.from('hello')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['hello'])
})

test('RegexParser: throws without regex', () => {
  expect(() => new RegexParser({ regex: null as any })).toThrow(TypeError)
})

test('RegexParser: splits correctly with various regex flags', async () => {
  const parser = new RegexParser({ regex: /ok/i })
  const source = Readable.from([Buffer.from('firstOKsecondok')])
  source.pipe(parser)
  const chunks = await collect(parser)
  expect(chunks.map((c) => c.toString())).toEqual(['first', 'second'])
})
