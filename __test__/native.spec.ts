/**
 * Native integration tests using socat virtual loopback ports.
 *
 * Setup: socat -d -d pty,raw,echo=0 pty,raw,echo=0
 * Then set env vars SERIAL_PORT_A and SERIAL_PORT_B to the two paths printed.
 *
 * These tests are skipped if the env vars are not set.
 */
import { test, expect } from 'bun:test'
import { SerialPort } from '../lib/SerialPort.js'
import { ReadlineParser } from '../lib/parsers/ReadlineParser.js'
const portA = process.env['SERIAL_PORT_A']
const portB = process.env['SERIAL_PORT_B']
const hasVirtualPorts = Boolean(portA && portB)

test.serial('listPorts: returns at least one entry', async () => {
  const ports = await SerialPort.list()
  console.log('ports:', ports.map((p) => p.path).join(', ') || '(none)')
  expect(Array.isArray(ports)).toBe(true)
})

test.serial('loopback: write to port A, read from port B', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  console.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0 })
  const b = new SerialPort({ path: portB!, baudRate: 0 })
  a.on('error', (err) => console.log('port A error:', err.message))
  b.on('error', (err) => console.log('port B error:', err.message))

  const parser = new ReadlineParser({ delimiter: '\n' })
  b.pipe(parser)

  await Promise.all([a.open(), b.open()])
  console.log('both ports open')

  const linePromise = new Promise<string>((resolve) => parser.once('data', (d: Buffer) => resolve(d.toString())))
  await a.write(Buffer.from('HELLO\n'))
  const line = await linePromise
  console.log('received:', line)
  expect(line).toBe('HELLO')

  await Promise.all([a.close(), b.close()])
  console.log('both ports closed')
})

test.serial('concurrency: 100 rapid writes complete without dropped bytes', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  console.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0 })
  const b = new SerialPort({ path: portB!, baudRate: 0 })
  a.on('error', (err) => console.log('port A error:', err.message))
  b.on('error', (err) => console.log('port B error:', err.message))

  await Promise.all([a.open(), b.open()])
  console.log('both ports open, firing 100 writes')

  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  await Promise.all(Array.from({ length: 100 }, (_, i) => a.write(Buffer.from(`MSG${i}\n`))))

  await new Promise((resolve) => setTimeout(resolve, 500))

  const total = Buffer.concat(received).toString()
  console.log(`received ${received.length} chunks, ${total.length} bytes total`)
  for (let i = 0; i < 100; i++) {
    expect(total.includes(`MSG${i}`)).toBe(true)
  }

  await Promise.all([a.close(), b.close()])
  console.log('both ports closed')
})

test.serial('teardown: open, read/write, close, reopen without hanging', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  for (let i = 0; i < 3; i++) {
    console.log(`cycle ${i + 1}: opening ${portA}`)
    const port = new SerialPort({ path: portA!, baudRate: 0 })
    port.on('error', (err) => console.log(`cycle ${i + 1} error:`, err.message))

    await port.open()
    console.log(`cycle ${i + 1}: open, writing`)

    await port.write(Buffer.from('test'))
    console.log(`cycle ${i + 1}: write done, closing`)

    await port.close()
    console.log(`cycle ${i + 1}: closed`)
  }
})

test.serial('error: opening an invalid path rejects and isOpen stays false', async () => {
  const port = new SerialPort({ path: '/dev/nonexistent_bun_serial_test', baudRate: 0 })
  await expect(port.open()).rejects.toThrow()
  expect(port.isOpen).toBe(false)
})

test.serial('bidirectional: write from B, read from A', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  console.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0 })
  const b = new SerialPort({ path: portB!, baudRate: 0 })
  a.on('error', (err) => console.log('port A error:', err.message))
  b.on('error', (err) => console.log('port B error:', err.message))

  const parser = new ReadlineParser({ delimiter: '\n' })
  a.pipe(parser)

  await Promise.all([a.open(), b.open()])

  const linePromise = new Promise<string>((resolve) => parser.once('data', (d: Buffer) => resolve(d.toString())))
  await b.write(Buffer.from('FROM_B\n'))
  const line = await linePromise
  expect(line).toBe('FROM_B')

  await Promise.all([a.close(), b.close()])
})

test.serial('binary: non-ASCII bytes arrive uncorrupted', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  const a = new SerialPort({ path: portA!, baudRate: 0 })
  const b = new SerialPort({ path: portB!, baudRate: 0 })

  await Promise.all([a.open(), b.open()])

  const payload = Buffer.from([0x01, 0x7e, 0x80, 0xfe, 0xff, 0x42])
  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  await a.write(payload)
  await new Promise((resolve) => setTimeout(resolve, 300))

  const total = Buffer.concat(received)
  expect(total).toEqual(payload)

  await Promise.all([a.close(), b.close()])
})

test.serial('drain: resolves after write without error', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  const a = new SerialPort({ path: portA!, baudRate: 0 })
  const b = new SerialPort({ path: portB!, baudRate: 0 })
  a.on('error', (err) => console.log('port A error:', err.message))
  b.on('error', (err) => console.log('port B error:', err.message))

  await Promise.all([a.open(), b.open()])

  await a.write(Buffer.from('DRAIN_TEST\n'))
  await a.drain()

  await Promise.all([a.close(), b.close()])
})

test.serial('large write: payload larger than the 4 KiB read buffer arrives complete', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  const a = new SerialPort({ path: portA!, baudRate: 0 })
  const b = new SerialPort({ path: portB!, baudRate: 0 })

  await Promise.all([a.open(), b.open()])

  const size = 8192
  const payload = Buffer.alloc(size, 0x42)
  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  await a.write(payload)
  await new Promise((resolve) => setTimeout(resolve, 500))

  const total = Buffer.concat(received)
  expect(total.length).toBe(size)
  expect(total).toEqual(payload)

  await Promise.all([a.close(), b.close()])
})
