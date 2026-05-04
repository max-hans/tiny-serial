import { test, expect } from 'bun:test'
import { SerialPort } from '../lib/SerialPort.js'

test('SerialPort: throws TypeError for empty path', () => {
  expect(() => new SerialPort({ path: '', baudRate: 9600 })).toThrow(/requires a path/)
})

test('SerialPort: throws TypeError for negative baudRate', () => {
  expect(() => new SerialPort({ path: '/dev/tty', baudRate: -1 })).toThrow(/baudRate/)
})

test('SerialPort: throws TypeError for undefined baudRate', () => {
  expect(() => new SerialPort({ path: '/dev/tty', baudRate: undefined as unknown as number })).toThrow(/baudRate/)
})

test('SerialPort: baudRate 0 is valid (skips baud-rate config on PTY devices)', () => {
  expect(() => new SerialPort({ path: '/dev/tty', baudRate: 0 })).not.toThrow()
})

test('SerialPort: throws TypeError for invalid dataBits', () => {
  expect(() => new SerialPort({ path: '/dev/tty', baudRate: 9600, dataBits: 4 as 8 })).toThrow(/dataBits/)
})

test('SerialPort: throws TypeError for invalid stopBits', () => {
  expect(() => new SerialPort({ path: '/dev/tty', baudRate: 9600, stopBits: 3 as 1 })).toThrow(/stopBits/)
})

test('SerialPort: throws TypeError for invalid parity', () => {
  expect(() => new SerialPort({ path: '/dev/tty', baudRate: 9600, parity: 'bad' as 'none' })).toThrow(/parity/)
})
