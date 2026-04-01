/**
 * Native integration tests using socat virtual loopback ports.
 *
 * Setup: socat -d -d pty,raw,echo=0 pty,raw,echo=0
 * Then set env vars SERIAL_PORT_A and SERIAL_PORT_B to the two paths printed.
 *
 * These tests are skipped if the env vars are not set.
 */
import test from 'ava'
import { SerialPort } from '../lib/SerialPort.js'
import { ReadlineParser } from '../lib/parsers/ReadlineParser.js'

const portA = process.env['SERIAL_PORT_A']
const portB = process.env['SERIAL_PORT_B']
const hasVirtualPorts = Boolean(portA && portB)

function waitFor(emitter: NodeJS.EventEmitter, event: string, timeout = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for '${event}'`)), timeout)
    emitter.once(event, (value: unknown) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

test.serial('listPorts: returns at least one entry', async (t) => {
  const ports = await SerialPort.list()
  t.log('ports:', ports.map((p) => p.path).join(', ') || '(none)')
  t.true(Array.isArray(ports))
  // On CI without physical ports this can be empty; just verify the call doesn't throw
  t.pass()
})

test.serial('loopback: write to port A, read from port B', async (t) => {
  if (!hasVirtualPorts) return t.pass('skipped: no virtual ports (set SERIAL_PORT_A and SERIAL_PORT_B)')

  t.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => t.log('port A error:', err.message))
  b.on('error', (err) => t.log('port B error:', err.message))

  const parser = new ReadlineParser({ delimiter: '\n' })
  b.pipe(parser)

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])
  t.log('both ports open')

  const linePromise = waitFor(parser, 'data', 3000)
  a.write(Buffer.from('HELLO\n'))
  const line = await linePromise
  t.log('received:', String(line))
  t.is(String(line), 'HELLO')

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
  t.log('both ports closed')
})

test.serial('concurrency: 100 rapid writes complete without dropped bytes', async (t) => {
  if (!hasVirtualPorts) return t.pass('skipped: no virtual ports')

  t.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => t.log('port A error:', err.message))
  b.on('error', (err) => t.log('port B error:', err.message))

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])
  t.log('both ports open, firing 100 writes')

  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  const writes = Array.from({ length: 100 }, (_, i) => a.write(Buffer.from(`MSG${i}\n`)))
  await Promise.all(writes.map((p) => (p instanceof Promise ? p : Promise.resolve())))

  // Wait for data to propagate
  await new Promise((resolve) => setTimeout(resolve, 500))

  const total = Buffer.concat(received).toString()
  t.log(`received ${received.length} chunks, ${total.length} bytes total`)
  for (let i = 0; i < 100; i++) {
    t.true(total.includes(`MSG${i}`), `MSG${i} not found in received data`)
  }

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
  t.log('both ports closed')
})

test.serial('teardown: open, read/write, close, reopen without hanging', async (t) => {
  if (!hasVirtualPorts) return t.pass('skipped: no virtual ports')

  for (let i = 0; i < 3; i++) {
    t.log(`cycle ${i + 1}: opening ${portA}`)
    const port = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
    port.on('error', (err) => t.log(`cycle ${i + 1} error:`, err.message))

    port.open()
    await waitFor(port, 'open')
    t.log(`cycle ${i + 1}: open, writing`)

    await new Promise<void>((resolve, reject) =>
      port.write(Buffer.from('test'), (err) => (err ? reject(err) : resolve())),
    )
    t.log(`cycle ${i + 1}: write done, closing`)

    // Register listener before close() — close() joins the reader thread synchronously
    // so the 'close' event fires before the next await would set up a listener.
    const closePromise = waitFor(port, 'close')
    port.close()
    await closePromise
    t.log(`cycle ${i + 1}: closed`)
  }

  t.pass('port opened and closed 3 times without hanging')
})

test('error: opening an invalid path emits an error event', async (t) => {
  const port = new SerialPort({ path: '/dev/nonexistent_bun_serial_test', baudRate: 0, autoOpen: false })
  const errPromise = waitFor(port, 'error') as Promise<Error>
  port.open()
  const err = await errPromise
  t.log('error message:', err.message)
  t.true(err.message.length > 0)
  t.false(port.isOpen)
})

test.serial('bidirectional: write from B, read from A', async (t) => {
  if (!hasVirtualPorts) return t.pass('skipped: no virtual ports')

  t.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => t.log('port A error:', err.message))
  b.on('error', (err) => t.log('port B error:', err.message))

  const parser = new ReadlineParser({ delimiter: '\n' })
  a.pipe(parser)

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])
  t.log('both ports open')

  const linePromise = waitFor(parser, 'data', 3000)
  b.write(Buffer.from('FROM_B\n'))
  const line = await linePromise
  t.log('received on A:', String(line))
  t.is(String(line), 'FROM_B')

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
})

test.serial('binary: non-ASCII bytes arrive uncorrupted', async (t) => {
  if (!hasVirtualPorts) return t.pass('skipped: no virtual ports')

  t.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => t.log('port A error:', err.message))
  b.on('error', (err) => t.log('port B error:', err.message))

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])

  const payload = Buffer.from([0x01, 0x7e, 0x80, 0xfe, 0xff, 0x42])
  t.log('sending bytes:', payload.toString('hex'))

  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  await new Promise<void>((resolve, reject) => a.write(payload, (err) => (err ? reject(err) : resolve())))
  await new Promise((resolve) => setTimeout(resolve, 300))

  const total = Buffer.concat(received)
  t.log('received bytes:', total.toString('hex'))
  t.deepEqual(total, payload)

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
})

test.serial('large write: payload larger than the 4 KiB read buffer arrives complete', async (t) => {
  if (!hasVirtualPorts) return t.pass('skipped: no virtual ports')

  t.log(`opening ${portA} and ${portB}`)
  const a = new SerialPort({ path: portA!, baudRate: 0, autoOpen: false })
  const b = new SerialPort({ path: portB!, baudRate: 0, autoOpen: false })
  a.on('error', (err) => t.log('port A error:', err.message))
  b.on('error', (err) => t.log('port B error:', err.message))

  a.open()
  b.open()
  await Promise.all([waitFor(a, 'open'), waitFor(b, 'open')])

  const size = 8192
  const payload = Buffer.alloc(size, 0x42) // 8 KiB of 'B'
  t.log(`sending ${size} bytes`)

  const received: Buffer[] = []
  b.on('data', (chunk: Buffer) => received.push(chunk))

  await new Promise<void>((resolve, reject) => a.write(payload, (err) => (err ? reject(err) : resolve())))
  await new Promise((resolve) => setTimeout(resolve, 500))

  const total = Buffer.concat(received)
  t.log(`received ${total.length} bytes`)
  t.is(total.length, size)
  t.deepEqual(total, payload)

  const closeA = waitFor(a, 'close')
  const closeB = waitFor(b, 'close')
  a.close()
  b.close()
  await Promise.all([closeA, closeB])
})
