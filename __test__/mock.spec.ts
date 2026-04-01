import { test, expect } from 'bun:test'
import { MockSerialPort } from '../lib/mock/MockSerialPort.js'
import { ReadlineParser } from '../lib/parsers/ReadlineParser.js'
import { ByteLengthParser } from '../lib/parsers/ByteLengthParser.js'

// Helper: wait for an event
function waitFor(emitter: NodeJS.EventEmitter, event: string, timeout = 500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for '${event}'`)), timeout)
    emitter.once(event, (value: unknown) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

// ────────── Basic I/O ──────────

test('MockSerialPort: emits open on autoOpen', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600 })
  await waitFor(port, 'open')
  expect(port.isOpen).toBe(true)
})

test('MockSerialPort: write is captured in getWrittenData', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.write(Buffer.from('HELLO'))
  expect(port.getWrittenData()).toEqual(Buffer.from('HELLO'))
})

test('MockSerialPort: multiple writes are concatenated', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.write(Buffer.from('A'))
  port.write(Buffer.from('B'))
  port.write(Buffer.from('C'))
  expect(port.getWrittenData()).toEqual(Buffer.from('ABC'))
})

test('MockSerialPort: clearWrittenData resets history', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.write(Buffer.from('X'))
  port.clearWrittenData()
  expect(port.getWrittenData()).toEqual(Buffer.from(''))
})

// ────────── mockReply ──────────

test('MockSerialPort: mockReply sends response when trigger is written', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply(Buffer.from('AT\r'), Buffer.from('OK\r'), 10)

  const dataPromise = waitFor(port, 'data')
  port.write(Buffer.from('AT\r'))
  const data = await dataPromise
  expect(data).toEqual(Buffer.from('OK\r'))
})

test('MockSerialPort: mockReply works with ReadlineParser (fragmentation)', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('AT\r', 'OK\r\n', 10)
  port.simulateFault('fragmentation')

  const parser = new ReadlineParser({ delimiter: '\r\n' })
  port.pipe(parser)

  const linePromise = waitFor(parser, 'data', 1000)
  port.write(Buffer.from('AT\r'))
  const line = await linePromise
  expect((line as any).toString()).toEqual('OK')
})

// ────────── simulateFault ──────────

test('MockSerialPort: simulateFault disconnect emits close', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  const closePromise = waitFor(port, 'close')
  port.simulateFault('disconnect')
  await closePromise
  expect(port.isOpen).toBe(false)
})

test('MockSerialPort: simulateFault timeout suppresses replies', async () => {
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
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(received).toBe(false)
})

test('MockSerialPort: clearFault re-enables replies', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('PING', 'PONG', 10)
  port.simulateFault('timeout')
  port.clearFault('timeout')

  const dataPromise = waitFor(port, 'data')
  port.write(Buffer.from('PING'))
  const data = await dataPromise
  expect(data).toEqual(Buffer.from('PONG'))
})

// ────────── pins ──────────

test('MockSerialPort: pins.setCTS emits pin-change event', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const eventPromise = waitFor(port, 'pin-change')
  port.pins.setCTS(true)
  const event = (await eventPromise) as { pin: string; value: boolean }
  expect(event.pin).toBe('CTS')
  expect(event.value).toBe(true)
  expect(port.pins.getCTS()).toBe(true)
})

test('MockSerialPort: pins.setDSR and getDSR round-trip', () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  expect(port.pins.getDSR()).toBe(false)
  port.pins.setDSR(true)
  expect(port.pins.getDSR()).toBe(true)
})

// ────────── close ──────────

test('MockSerialPort: close sets isOpen to false and emits close', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  expect(port.isOpen).toBe(true)
  const closePromise = waitFor(port, 'close')
  port.close()
  await closePromise
  expect(port.isOpen).toBe(false)
})

// ────────── autoOpen / callbacks ──────────

test('MockSerialPort: autoOpen false keeps isOpen false until explicit open', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  await new Promise((resolve) => process.nextTick(resolve))
  expect(port.isOpen).toBe(false)
  port.open()
  await waitFor(port, 'open')
  expect(port.isOpen).toBe(true)
})

test('MockSerialPort: open callback receives null on success', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const err = await new Promise<Error | null>((resolve) => port.open(resolve))
  expect(err).toBe(null)
  expect(port.isOpen).toBe(true)
})

test('MockSerialPort: close callback receives null on success', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  const err = await new Promise<Error | null>((resolve) => port.close(resolve))
  expect(err).toBe(null)
  expect(port.isOpen).toBe(false)
})

test('MockSerialPort: isOpen transitions false → open → true → close → false', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  expect(port.isOpen).toBe(false)
  port.open()
  await waitFor(port, 'open')
  expect(port.isOpen).toBe(true)
  const closePromise = waitFor(port, 'close')
  port.close()
  await closePromise
  expect(port.isOpen).toBe(false)
})

// ────────── mockReply edge cases ──────────

test('MockSerialPort: mockReply not triggered when pattern not present in write', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('PING', 'PONG', 10)

  let received = false
  port.on('data', () => {
    received = true
  })
  port.write(Buffer.from('SOMETHING_ELSE'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(received).toBe(false)
})

test('MockSerialPort: multiple mockReply patterns work independently', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('ATI', 'v1.0', 10)
  port.mockReply('ATZ', 'OK', 10)

  const first = waitFor(port, 'data')
  port.write(Buffer.from('ATI'))
  expect(((await first) as Buffer).toString()).toBe('v1.0')

  const second = waitFor(port, 'data')
  port.write(Buffer.from('ATZ'))
  expect(((await second) as Buffer).toString()).toBe('OK')
})

test('MockSerialPort: mockReply is chainable', () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const result = port.mockReply('a', 'b').mockReply('c', 'd')
  expect(result).toBe(port)
})

// ────────── simulateFault / clearFault ──────────

test('MockSerialPort: simulateFault fragmentation delivers data one byte at a time', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('PING', 'PONG', 0)
  port.simulateFault('fragmentation')

  const chunks: Buffer[] = []
  port.on('data', (chunk: Buffer) => chunks.push(chunk))
  port.write(Buffer.from('PING'))
  await new Promise((resolve) => setTimeout(resolve, 50))

  // Each byte of 'PONG' arrives in its own chunk
  expect(chunks.length).toBe(4)
  expect(Buffer.concat(chunks).toString()).toBe('PONG')
})

test('MockSerialPort: clearFault fragmentation restores bulk delivery', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('PING', 'PONG', 0)
  port.simulateFault('fragmentation')
  port.clearFault('fragmentation')

  const chunks: Buffer[] = []
  port.on('data', (chunk: Buffer) => chunks.push(chunk))
  port.write(Buffer.from('PING'))
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(chunks.length).toBe(1)
  expect(chunks[0].toString()).toBe('PONG')
})

// ────────── pins ──────────

test('MockSerialPort: all pins start as false', () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  expect(port.pins.getCTS()).toBe(false)
  expect(port.pins.getDSR()).toBe(false)
  expect(port.pins.getDCD()).toBe(false)
})

test('MockSerialPort: setDCD and getDCD round-trip', () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.pins.setDCD(true)
  expect(port.pins.getDCD()).toBe(true)
  port.pins.setDCD(false)
  expect(port.pins.getDCD()).toBe(false)
})

test('MockSerialPort: setDSR emits pin-change event', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const eventPromise = waitFor(port, 'pin-change')
  port.pins.setDSR(true)
  const event = (await eventPromise) as { pin: string; value: boolean }
  expect(event.pin).toBe('DSR')
  expect(event.value).toBe(true)
})

// ────────── parser integration ──────────

test('MockSerialPort: piped through ByteLengthParser emits fixed-size packets', async () => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')

  const parser = new ByteLengthParser({ length: 3 })
  port.pipe(parser)

  const packets: Buffer[] = []
  parser.on('data', (chunk: Buffer) => packets.push(chunk))

  port.mockReply('go', 'ABCDEF', 0) // 6 bytes → 2 packets of 3
  port.write(Buffer.from('go'))
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(packets.length).toBe(2)
  expect(packets[0].toString()).toBe('ABC')
  expect(packets[1].toString()).toBe('DEF')
})
