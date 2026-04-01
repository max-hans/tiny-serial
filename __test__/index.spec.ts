import { expect, test } from 'bun:test'
import { NativeSerialPort, listPorts } from '../index'

test('NativeSerialPort class is exported from native binding', () => {
  expect(typeof NativeSerialPort).toEqual('function')
})

test('listPorts function is exported from native binding', () => {
  expect(typeof listPorts).toEqual('function')
})
