import { Readable } from 'node:stream'
import test from 'ava'
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

test('ReadlineParser: splits multi-line chunk', async (t) => {
  const parser = new ReadlineParser({ delimiter: '\n' })
  const source = Readable.from([Buffer.from('hello\nworld\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['hello', 'world'],
  )
})

test('ReadlineParser: reassembles lines from 1-byte chunks', async (t) => {
  const parser = new ReadlineParser({ delimiter: '\n' })
  const data = Buffer.from('foo\nbar\n')
  const source = Readable.from(Array.from(data).map((b) => Buffer.from([b])))
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['foo', 'bar'],
  )
})

test('ReadlineParser: flushes remainder without trailing delimiter', async (t) => {
  const parser = new ReadlineParser({ delimiter: '\n' })
  const source = Readable.from([Buffer.from('hello')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['hello'],
  )
})

test('ReadlineParser: supports multi-char delimiter', async (t) => {
  const parser = new ReadlineParser({ delimiter: '\r\n' })
  const source = Readable.from([Buffer.from('a\r\nb\r\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['a', 'b'],
  )
})

test('ReadlineParser: throws on empty delimiter', (t) => {
  t.throws(() => new ReadlineParser({ delimiter: '' }), { instanceOf: TypeError })
})

test('ReadlineParser: default delimiter is newline', async (t) => {
  const parser = new ReadlineParser()
  const source = Readable.from([Buffer.from('a\nb\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['a', 'b'],
  )
})

test('ReadlineParser: includeDelimiter appends delimiter to each line', async (t) => {
  const parser = new ReadlineParser({ delimiter: '\n', includeDelimiter: true })
  const source = Readable.from([Buffer.from('hello\nworld\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['hello\n', 'world\n'],
  )
})

test('ReadlineParser: includeDelimiter with multi-char delimiter', async (t) => {
  const parser = new ReadlineParser({ delimiter: '\r\n', includeDelimiter: true })
  const source = Readable.from([Buffer.from('a\r\nb\r\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['a\r\n', 'b\r\n'],
  )
})

test('ReadlineParser: remainder flushed without appending delimiter even when includeDelimiter is true', async (t) => {
  const parser = new ReadlineParser({ delimiter: '\n', includeDelimiter: true })
  const source = Readable.from([Buffer.from('partial')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['partial'],
  )
})

// ────────── ByteLengthParser ──────────

test('ByteLengthParser: emits exact length packets', async (t) => {
  const parser = new ByteLengthParser({ length: 4 })
  const source = Readable.from([Buffer.from('abcdefgh')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['abcd', 'efgh'],
  )
})

test('ByteLengthParser: holds remainder until flush', async (t) => {
  const parser = new ByteLengthParser({ length: 4 })
  const source = Readable.from([Buffer.from('abcde')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['abcd', 'e'],
  )
})

test('ByteLengthParser: reassembles across multiple chunks', async (t) => {
  const parser = new ByteLengthParser({ length: 3 })
  const source = Readable.from([Buffer.from('ab'), Buffer.from('cd'), Buffer.from('ef')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['abc', 'def'],
  )
})

test('ByteLengthParser: throws on length < 1', (t) => {
  t.throws(() => new ByteLengthParser({ length: 0 }), { instanceOf: TypeError })
})

test('ByteLengthParser: chunk exactly fills one packet with no remainder', async (t) => {
  const parser = new ByteLengthParser({ length: 5 })
  const source = Readable.from([Buffer.from('hello')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['hello'],
  )
})

test('ByteLengthParser: single large chunk produces multiple complete packets', async (t) => {
  const parser = new ByteLengthParser({ length: 3 })
  const source = Readable.from([Buffer.from('abcdefghi')]) // 9 bytes → 3 packets
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['abc', 'def', 'ghi'],
  )
})

// ────────── InterByteTimeoutParser ──────────

test('InterByteTimeoutParser: emits buffer after timeout', async (t) => {
  const parser = new InterByteTimeoutParser({ interval: 20 })
  const chunks: Buffer[] = []
  parser.on('data', (chunk: Buffer) => chunks.push(chunk))

  parser.write(Buffer.from('hello'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  parser.end()

  t.is(chunks.length, 1)
  t.is(chunks[0].toString(), 'hello')
})

test('InterByteTimeoutParser: accumulates bytes within the interval', async (t) => {
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

  t.is(chunks.length, 1)
  t.is(chunks[0].toString(), 'abc')
})

test('InterByteTimeoutParser: throws on interval < 1', (t) => {
  t.throws(() => new InterByteTimeoutParser({ interval: 0 }), { instanceOf: TypeError })
})

test('InterByteTimeoutParser: two bursts separated by timeout produce two emissions', async (t) => {
  const parser = new InterByteTimeoutParser({ interval: 30 })
  const chunks: Buffer[] = []
  parser.on('data', (chunk: Buffer) => chunks.push(chunk))

  parser.write(Buffer.from('first'))
  await new Promise((resolve) => setTimeout(resolve, 80))
  parser.write(Buffer.from('second'))
  await new Promise((resolve) => setTimeout(resolve, 80))
  parser.end()

  t.is(chunks.length, 2)
  t.is(chunks[0].toString(), 'first')
  t.is(chunks[1].toString(), 'second')
})

test('InterByteTimeoutParser: emits immediately when maxBufferSize is reached', async (t) => {
  const parser = new InterByteTimeoutParser({ interval: 5000, maxBufferSize: 4 })
  const chunks: Buffer[] = []
  parser.on('data', (chunk: Buffer) => chunks.push(chunk))

  parser.write(Buffer.from('hello')) // 5 bytes >= maxBufferSize 4, emits without waiting
  await new Promise((resolve) => setTimeout(resolve, 50))

  t.is(chunks.length, 1)
  t.is(chunks[0].toString(), 'hello')
})
// ────────── RegexParser (Functional Compatibility) ──────────

test('RegexParser: splits on regex matches and discards delimiter', async (t) => {
  const parser = new RegexParser({ regex: /\r\n/ })
  const source = Readable.from([Buffer.from('foo\r\nbar\r\n')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['foo', 'bar'], // Delimiters stripped
  )
})

test('RegexParser: handles multiple delimiters and ignores empty matches', async (t) => {
  const parser = new RegexParser({ regex: /OK|ERROR/ })
  const source = Readable.from([Buffer.from('firstOKsecondERROR')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['first', 'second'], // OK/ERROR stripped
  )
})

test('RegexParser: flushes remainder on end', async (t) => {
  const parser = new RegexParser({ regex: /\n/ })
  const source = Readable.from([Buffer.from('hello')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['hello'],
  )
})

test('RegexParser: throws without regex', (t) => {
  // Pass null as any to trigger the internal check
  t.throws(() => new RegexParser({ regex: null as any }), { instanceOf: TypeError })
})

test('RegexParser: splits correctly with various regex flags', async (t) => {
  const parser = new RegexParser({ regex: /ok/i }) // case-insensitive
  const source = Readable.from([Buffer.from('firstOKsecondok')])
  source.pipe(parser)
  const chunks = await collect(parser)
  t.deepEqual(
    chunks.map((c) => c.toString()),
    ['first', 'second'],
  )
})
