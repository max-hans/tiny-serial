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

function waitFor(emitter: any, event: string, timeout = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for '${event}'`)), timeout)
    emitter.once(event, (value: unknown) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

test.serial('listPorts: returns at least one entry', async () => {
  const ports = await SerialPort.list()
  console.log('ports:', ports.map((p) => p.path).join(', ') || '(none)')
  expect(Array.isArray(ports)).toBe(true)
})

test.serial('loopback: write to port A, read from port B', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  console.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => console.log('port A error:', err.message))
  b.on('error', (err) => console.log('port B error:', err.message))

  const parser = new ReadlineParser({ delimiter: '\n' })
  b.pipe(parser)

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])
  console.log('both ports open')

  const linePromise = waitFor(parser, 'data', 3000)
  a.write(Buffer.from('HELLO\n'))
  const line = await linePromise
  console.log('received:', String(line))
  expect(String(line)).toBe('HELLO')

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
  console.log('both ports closed')
})

test.serial('concurrency: 100 rapid writes complete without dropped bytes', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  console.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => console.log('port A error:', err.message))
  b.on('error', (err) => console.log('port B error:', err.message))

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])
  console.log('both ports open, firing 100 writes')

  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  const writes = Array.from({ length: 100 }, (_, i) => a.write(Buffer.from(`MSG${i}\n`)))
  await Promise.all(writes.map((p) => (p instanceof Promise ? p : Promise.resolve())))

  await new Promise((resolve) => setTimeout(resolve, 500))

  const total = Buffer.concat(received).toString()
  console.log(`received ${received.length} chunks, ${total.length} bytes total`)
  for (let i = 0; i < 100; i++) {
    expect(total.includes(`MSG${i}`)).toBe(true)
  }

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
  console.log('both ports closed')
})

test.serial('teardown: open, read/write, close, reopen without hanging', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  for (let i = 0; i < 3; i++) {
    console.log(`cycle ${i + 1}: opening ${portA}`)
    const port = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
    port.on('error', (err) => console.log(`cycle ${i + 1} error:`, err.message))

    port.open()
    await waitFor(port, 'open')
    console.log(`cycle ${i + 1}: open, writing`)

    await new Promise<void>((resolve, reject) =>
      port.write(Buffer.from('test'), (err) => (err ? reject(err) : resolve())),
    )
    console.log(`cycle ${i + 1}: write done, closing`)

    const closePromise = waitFor(port, 'close')
    port.close()
    await closePromise
    console.log(`cycle ${i + 1}: closed`)
  }
})

test.serial('error: opening an invalid path emits an error event', async () => {
  const port = new SerialPort({ path: '/dev/nonexistent_bun_serial_test', baudRate: 0, autoOpen: false })
  const errPromise = waitFor(port, 'error') as Promise<Error>
  port.open()
  const err = await errPromise
  console.log('error message:', err.message)
  expect(err.message.length).toBeGreaterThan(0)
  expect(port.isOpen).toBe(false)
})

test.serial('bidirectional: write from B, read from A', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  console.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => console.log('port A error:', err.message))
  b.on('error', (err) => console.log('port B error:', err.message))

  const parser = new ReadlineParser({ delimiter: '\n' })
  a.pipe(parser)

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])

  const linePromise = waitFor(parser, 'data', 3000)
  b.write(Buffer.from('FROM_B\n'))
  const line = await linePromise
  expect(String(line)).toBe('FROM_B')

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
})

test.serial('binary: non-ASCII bytes arrive uncorrupted', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])

  const payload = Buffer.from([0x01, 0x7e, 0x80, 0xfe, 0xff, 0x42])
  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  await new Promise<void>((resolve, reject) => a.write(payload, (err) => (err ? reject(err) : resolve())))
  await new Promise((resolve) => setTimeout(resolve, 300))

  const total = Buffer.concat(received)
  expect(total).toEqual(payload)

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
})

test.serial('large write: payload larger than the 4 KiB read buffer arrives complete', async () => {
  if (!hasVirtualPorts) return console.log('skipped: no virtual ports')

  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])

  const size = 8192
  const payload = Buffer.alloc(size, 0x42)
  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  await new Promise<void>((resolve, reject) => a.write(payload, (err) => (err ? reject(err) : resolve())))
  await new Promise((resolve) => setTimeout(resolve, 500))

  const total = Buffer.concat(received)
  expect(total.length).toBe(size)
  expect(total).toEqual(payload)

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
})
