/**
 * Bun-compatible test suite for the pure TypeScript layer.
 * Run with: bun test __test__/bun-compat.test.ts
 *
 * Imports only from lib/ (no native bindings required).
 */
import { describe, it, expect } from 'bun:test'
import { ReadlineParser } from '../lib/parsers/ReadlineParser.js'
import { ByteLengthParser } from '../lib/parsers/ByteLengthParser.js'
import { InterByteTimeoutParser } from '../lib/parsers/InterByteTimeoutParser.js'
import { RegexParser } from '../lib/parsers/RegexParser.js'
import { MockSerialPort } from '../lib/mock/MockSerialPort.js'

function waitFor(emitter: NodeJS.EventEmitter, event: string, timeout = 500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for '${event}'`)), timeout)
    emitter.once(event, (value: unknown) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

// ────────── ReadlineParser ──────────

describe('ReadlineParser (Bun)', () => {
  it('splits on newline delimiter', async () => {
    const parser = new ReadlineParser({ delimiter: '\n' })
    const chunks: string[] = []
    parser.on('data', (c: Buffer) => chunks.push(c.toString()))
    parser.write(Buffer.from('hello\nworld\n'))
    parser.end()
    await waitFor(parser, 'finish')
    expect(chunks).toEqual(['hello', 'world'])
  })

  it('reassembles from 1-byte chunks', async () => {
    const parser = new ReadlineParser({ delimiter: '\n' })
    const chunks: string[] = []
    parser.on('data', (c: Buffer) => chunks.push(c.toString()))
    const data = Buffer.from('ab\ncd\n')
    for (let i = 0; i < data.length; i++) parser.write(data.subarray(i, i + 1))
    parser.end()
    await waitFor(parser, 'finish')
    expect(chunks).toEqual(['ab', 'cd'])
  })
})

// ────────── ByteLengthParser ──────────

describe('ByteLengthParser (Bun)', () => {
  it('emits exact-length packets', async () => {
    const parser = new ByteLengthParser({ length: 3 })
    const chunks: string[] = []
    parser.on('data', (c: Buffer) => chunks.push(c.toString()))
    parser.write(Buffer.from('abcdef'))
    parser.end()
    await waitFor(parser, 'finish')
    expect(chunks).toEqual(['abc', 'def'])
  })
})

// ────────── InterByteTimeoutParser ──────────

describe('InterByteTimeoutParser (Bun)', () => {
  it('emits buffer after timeout', async () => {
    const parser = new InterByteTimeoutParser({ interval: 20 })
    const chunks: string[] = []
    parser.on('data', (c: Buffer) => chunks.push(c.toString()))
    parser.write(Buffer.from('hello'))
    await new Promise((r) => setTimeout(r, 60))
    expect(chunks).toEqual(['hello'])
  })
})

// ────────── RegexParser ──────────

describe('RegexParser (Bun)', () => {
  it('splits on regex', async () => {
    const parser = new RegexParser({ regex: /\r\n/ })
    const chunks: string[] = []
    parser.on('data', (c: Buffer) => chunks.push(c.toString()))
    parser.write(Buffer.from('foo\r\nbar\r\n'))
    parser.end()
    await waitFor(parser, 'finish')
    expect(chunks).toEqual(['foo', 'bar'])
  })
})

// ────────── MockSerialPort ──────────

describe('MockSerialPort (Bun)', () => {
  it('captures written data', async () => {
    const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
    port.open()
    await waitFor(port, 'open')
    port.write(Buffer.from('HELLO'))
    expect(port.getWrittenData()).toEqual(Buffer.from('HELLO'))
  })

  it('mockReply responds to trigger', async () => {
    const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
    port.open()
    await waitFor(port, 'open')
    port.mockReply('AT\r', 'OK\r', 10)
    const dataPromise = waitFor(port, 'data')
    port.write(Buffer.from('AT\r'))
    const data = await dataPromise
    expect(data).toEqual(Buffer.from('OK\r'))
  })

  it('simulateFault timeout suppresses replies', async () => {
    const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
    port.open()
    await waitFor(port, 'open')
    port.mockReply('PING', 'PONG', 10)
    port.simulateFault('timeout')
    let received = false
    port.on('data', () => {
      received = true
    })
    port.write(Buffer.from('PING'))
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toBe(false)
  })

  it('drain resolves with null', async () => {
    const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
    port.open()
    await waitFor(port, 'open')
    const err = await new Promise<Error | null>((resolve) => port.drain(resolve))
    expect(err).toBe(null)
  })

  it('pins.setCTS emits pin-change', async () => {
    const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
    const eventPromise = waitFor(port, 'pin-change') as Promise<{ pin: string; value: boolean }>
    port.pins.setCTS(true)
    const event = await eventPromise
    expect(event.pin).toBe('CTS')
    expect(event.value).toBe(true)
  })
})
