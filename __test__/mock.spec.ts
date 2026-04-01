import test from 'ava'
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

test('MockSerialPort: emits open on autoOpen', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600 })
  await waitFor(port, 'open')
  t.true(port.isOpen)
})

test('MockSerialPort: write is captured in getWrittenData', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.write(Buffer.from('HELLO'))
  t.deepEqual(port.getWrittenData(), Buffer.from('HELLO'))
})

test('MockSerialPort: multiple writes are concatenated', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.write(Buffer.from('A'))
  port.write(Buffer.from('B'))
  port.write(Buffer.from('C'))
  t.deepEqual(port.getWrittenData(), Buffer.from('ABC'))
})

test('MockSerialPort: clearWrittenData resets history', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.write(Buffer.from('X'))
  port.clearWrittenData()
  t.deepEqual(port.getWrittenData(), Buffer.from(''))
})

// ────────── mockReply ──────────

test('MockSerialPort: mockReply sends response when trigger is written', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply(Buffer.from('AT\r'), Buffer.from('OK\r'), 10)

  const dataPromise = waitFor(port, 'data')
  port.write(Buffer.from('AT\r'))
  const data = await dataPromise
  t.deepEqual(data, Buffer.from('OK\r'))
})

test('MockSerialPort: mockReply works with ReadlineParser (fragmentation)', async (t) => {
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
  t.is(line.toString(), 'OK')
})

// ────────── simulateFault ──────────

test('MockSerialPort: simulateFault disconnect emits close', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  const closePromise = waitFor(port, 'close')
  port.simulateFault('disconnect')
  await closePromise
  t.false(port.isOpen)
})

test('MockSerialPort: simulateFault timeout suppresses replies', async (t) => {
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
  t.false(received)
})

test('MockSerialPort: clearFault re-enables replies', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('PING', 'PONG', 10)
  port.simulateFault('timeout')
  port.clearFault('timeout')

  const dataPromise = waitFor(port, 'data')
  port.write(Buffer.from('PING'))
  const data = await dataPromise
  t.deepEqual(data, Buffer.from('PONG'))
})

// ────────── pins ──────────

test('MockSerialPort: pins.setCTS emits pin-change event', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const eventPromise = waitFor(port, 'pin-change')
  port.pins.setCTS(true)
  const event = (await eventPromise) as { pin: string; value: boolean }
  t.is(event.pin, 'CTS')
  t.true(event.value)
  t.true(port.pins.getCTS())
})

test('MockSerialPort: pins.setDSR and getDSR round-trip', (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  t.false(port.pins.getDSR())
  port.pins.setDSR(true)
  t.true(port.pins.getDSR())
})

// ────────── close ──────────

test('MockSerialPort: close sets isOpen to false and emits close', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  t.true(port.isOpen)
  const closePromise = waitFor(port, 'close')
  port.close()
  await closePromise
  t.false(port.isOpen)
})

// ────────── autoOpen / callbacks ──────────

test('MockSerialPort: autoOpen false keeps isOpen false until explicit open', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  await new Promise((resolve) => process.nextTick(resolve))
  t.false(port.isOpen)
  port.open()
  await waitFor(port, 'open')
  t.true(port.isOpen)
})

test('MockSerialPort: open callback receives null on success', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const err = await new Promise<Error | null>((resolve) => port.open(resolve))
  t.is(err, null)
  t.true(port.isOpen)
})

test('MockSerialPort: close callback receives null on success', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  const err = await new Promise<Error | null>((resolve) => port.close(resolve))
  t.is(err, null)
  t.false(port.isOpen)
})

test('MockSerialPort: isOpen transitions false → open → true → close → false', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  t.false(port.isOpen)
  port.open()
  await waitFor(port, 'open')
  t.true(port.isOpen)
  const closePromise = waitFor(port, 'close')
  port.close()
  await closePromise
  t.false(port.isOpen)
})

// ────────── mockReply edge cases ──────────

test('MockSerialPort: mockReply not triggered when pattern not present in write', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('PING', 'PONG', 10)

  let received = false
  port.on('data', () => { received = true })
  port.write(Buffer.from('SOMETHING_ELSE'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  t.false(received)
})

test('MockSerialPort: multiple mockReply patterns work independently', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.open()
  await waitFor(port, 'open')
  port.mockReply('ATI', 'v1.0', 10)
  port.mockReply('ATZ', 'OK', 10)

  const first = waitFor(port, 'data')
  port.write(Buffer.from('ATI'))
  t.is((await first as Buffer).toString(), 'v1.0')

  const second = waitFor(port, 'data')
  port.write(Buffer.from('ATZ'))
  t.is((await second as Buffer).toString(), 'OK')
})

test('MockSerialPort: mockReply is chainable', (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const result = port.mockReply('a', 'b').mockReply('c', 'd')
  t.is(result, port)
})

// ────────── simulateFault / clearFault ──────────

test('MockSerialPort: simulateFault fragmentation delivers data one byte at a time', async (t) => {
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
  t.is(chunks.length, 4)
  t.is(Buffer.concat(chunks).toString(), 'PONG')
})

test('MockSerialPort: clearFault fragmentation restores bulk delivery', async (t) => {
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

  t.is(chunks.length, 1)
  t.is(chunks[0].toString(), 'PONG')
})

// ────────── pins ──────────

test('MockSerialPort: all pins start as false', (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  t.false(port.pins.getCTS())
  t.false(port.pins.getDSR())
  t.false(port.pins.getDCD())
})

test('MockSerialPort: setDCD and getDCD round-trip', (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  port.pins.setDCD(true)
  t.true(port.pins.getDCD())
  port.pins.setDCD(false)
  t.false(port.pins.getDCD())
})

test('MockSerialPort: setDSR emits pin-change event', async (t) => {
  const port = new MockSerialPort({ path: '/dev/null', baudRate: 9600, autoOpen: false })
  const eventPromise = waitFor(port, 'pin-change')
  port.pins.setDSR(true)
  const event = (await eventPromise) as { pin: string; value: boolean }
  t.is(event.pin, 'DSR')
  t.true(event.value)
})

// ────────── parser integration ──────────

test('MockSerialPort: piped through ByteLengthParser emits fixed-size packets', async (t) => {
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

  t.is(packets.length, 2)
  t.is(packets[0].toString(), 'ABC')
  t.is(packets[1].toString(), 'DEF')
})
