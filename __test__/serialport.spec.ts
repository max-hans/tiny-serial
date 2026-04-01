/**
 * Unit tests for SerialPort constructor validation and autoOpen behaviour.
 * These tests do NOT open any port (autoOpen: false throughout) so they run
 * without a compiled .node binary or physical/virtual hardware.
 */
import test from 'ava'
import { SerialPort } from '../lib/SerialPort.js'

// ────────── Option validation ──────────

test('SerialPort: throws TypeError for empty path', (t) => {
  t.throws(() => new SerialPort({ path: '', baudRate: 9600 }), {
    instanceOf: TypeError,
    message: /requires a path/,
  })
})

test('SerialPort: throws TypeError for negative baudRate', (t) => {
  t.throws(() => new SerialPort({ path: '/dev/tty', baudRate: -1 }), {
    instanceOf: TypeError,
    message: /baudRate/,
  })
})

test('SerialPort: throws TypeError for undefined baudRate', (t) => {
  t.throws(() => new SerialPort({ path: '/dev/tty', baudRate: undefined as unknown as number }), {
    instanceOf: TypeError,
    message: /baudRate/,
  })
})

test('SerialPort: baudRate 0 is valid (skips baud-rate config on PTY devices)', (t) => {
  t.notThrows(() => new SerialPort({ path: '/dev/tty', baudRate: 0, autoOpen: false }))
})

test('SerialPort: throws TypeError for invalid dataBits', (t) => {
  t.throws(() => new SerialPort({ path: '/dev/tty', baudRate: 9600, dataBits: 4 as 8 }), {
    instanceOf: TypeError,
    message: /dataBits/,
  })
})

test('SerialPort: throws TypeError for invalid stopBits', (t) => {
  t.throws(() => new SerialPort({ path: '/dev/tty', baudRate: 9600, stopBits: 3 as 1 }), {
    instanceOf: TypeError,
    message: /stopBits/,
  })
})

test('SerialPort: throws TypeError for invalid parity', (t) => {
  t.throws(() => new SerialPort({ path: '/dev/tty', baudRate: 9600, parity: 'bad' as 'none' }), {
    instanceOf: TypeError,
    message: /parity/,
  })
})

// ────────── autoOpen ──────────

test('SerialPort: autoOpen false leaves isOpen false after nextTick', async (t) => {
  const port = new SerialPort({ path: '/dev/nonexistent', baudRate: 9600, autoOpen: false })
  t.false(port.isOpen)
  await new Promise((resolve) => process.nextTick(resolve))
  t.false(port.isOpen)
})

test('SerialPort: path is stored on the instance', (t) => {
  const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 9600, autoOpen: false })
  t.is(port.path, '/dev/ttyUSB0')
})
