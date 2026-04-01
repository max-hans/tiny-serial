import test from 'ava'
import { NativeSerialPort, listPorts } from '../index'

test('NativeSerialPort class is exported from native binding', (t) => {
  t.is(typeof NativeSerialPort, 'function')
})

test('listPorts function is exported from native binding', (t) => {
  t.is(typeof listPorts, 'function')
})
