import { Duplex } from 'node:stream'
import type { SerialPortOptions, PortInfo } from './types.js'

// Lazy-load the native binding. Dynamic import() works in both CJS (compiled output) and ESM (AVA tests).
type NativeModule = typeof import('../index.js')
let _nativePromise: Promise<NativeModule> | null = null
function getNative(): Promise<NativeModule> {
  if (!_nativePromise) {
    _nativePromise = import('../index.js')
  }
  return _nativePromise
}

const VALID_DATA_BITS = [5, 6, 7, 8] as const
const VALID_STOP_BITS = [1, 1.5, 2] as const
const VALID_PARITY = ['none', 'odd', 'even', 'mark', 'space'] as const

function validateOptions(options: SerialPortOptions): void {
  if (!options.path) throw new TypeError('SerialPort requires a path')
  if (options.baudRate === undefined || options.baudRate === null || options.baudRate < 0) throw new TypeError('SerialPort baudRate must be a non-negative number (0 skips baud rate configuration, e.g. for PTY devices)')
  if (options.dataBits !== undefined && !(VALID_DATA_BITS as readonly number[]).includes(options.dataBits)) {
    throw new TypeError(`SerialPort dataBits must be one of: ${VALID_DATA_BITS.join(', ')}`)
  }
  if (options.stopBits !== undefined && !(VALID_STOP_BITS as readonly number[]).includes(options.stopBits)) {
    throw new TypeError(`SerialPort stopBits must be one of: ${VALID_STOP_BITS.join(', ')}`)
  }
  if (options.parity !== undefined && !(VALID_PARITY as readonly string[]).includes(options.parity)) {
    throw new TypeError(`SerialPort parity must be one of: ${VALID_PARITY.join(', ')}`)
  }
}

export class SerialPort extends Duplex {
  public readonly path: string
  public isOpen: boolean
  private _options: SerialPortOptions
  private _native: InstanceType<(typeof import('../index.js'))['NativeSerialPort']> | null

  constructor(options: SerialPortOptions, openCallback?: (err: Error | null) => void) {
    super()
    validateOptions(options)
    this.path = options.path
    this.isOpen = false
    this._options = options
    this._native = null

    if (options.autoOpen !== false) {
      process.nextTick(() => this.open(openCallback))
    }
  }

  _read(_size: number): void {
    // Data is proactively pushed from the Rust ThreadSafeFunction callback
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (err?: Error | null) => void): void {
    if (!this._native) {
      callback(new Error('Port is not open'))
      return
    }
    this._native
      .write(chunk)
      .then(() => callback())
      .catch((err: Error) => callback(err))
  }

  _destroy(err: Error | null, callback: (err: Error | null) => void): void {
    if (this.isOpen) {
      this.close(() => callback(err))
    } else {
      callback(err)
    }
  }

  open(callback?: (err: Error | null) => void): void {
    getNative()
      .then(({ NativeSerialPort }) => {
        this._native = new NativeSerialPort()
        try {
          this._native.open(this.path, this._options.baudRate, (err: Error | null, data: Buffer) => {
            if (err) {
              this.emit('error', err)
            } else {
              this.push(data)
            }
          })
          this.isOpen = true
          this.emit('open')
          callback?.(null)
        } catch (err) {
          this._native = null
          const error = err instanceof Error ? err : new Error(String(err))
          this.emit('error', error)
          callback?.(error)
        }
      })
      .catch((err: Error) => {
        this.emit('error', err)
        callback?.(err)
      })
  }

  close(callback?: (err: Error | null) => void): void {
    if (!this._native) {
      callback?.(null)
      return
    }
    try {
      this._native.close()
      this._native = null
      this.isOpen = false
      this.emit('close')
      callback?.(null)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      callback?.(error)
    }
  }

  drain(callback?: (err: Error | null) => void): void {
    if (!this._native) {
      callback?.(new Error('Port is not open'))
      return
    }
    this._native
      .drain()
      .then(() => callback?.(null))
      .catch((err: Error) => callback?.(err))
  }

  static async list(): Promise<PortInfo[]> {
    const { listPorts } = await getNative()
    return listPorts() as unknown as PortInfo[]
  }
}
