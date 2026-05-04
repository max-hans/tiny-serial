import { Readable } from 'node:stream'
import type { SerialPortOptions, PortInfo, INativeSerialPort, INativeSerialPortClass } from './types.js'

const VALID_DATA_BITS = [5, 6, 7, 8] as const
const VALID_STOP_BITS = [1, 1.5, 2] as const
const VALID_PARITY = ['none', 'odd', 'even', 'mark', 'space'] as const

function validateOptions(options: SerialPortOptions): void {
  if (!options.path) throw new TypeError('SerialPort requires a path')
  if (options.baudRate === undefined || options.baudRate === null || options.baudRate < 0)
    throw new TypeError(
      'SerialPort baudRate must be a non-negative number (0 skips baud rate configuration, e.g. for PTY devices)',
    )
  if (options.dataBits !== undefined && !(VALID_DATA_BITS as readonly number[]).includes(options.dataBits))
    throw new TypeError(`SerialPort dataBits must be one of: ${VALID_DATA_BITS.join(', ')}`)
  if (options.stopBits !== undefined && !(VALID_STOP_BITS as readonly number[]).includes(options.stopBits))
    throw new TypeError(`SerialPort stopBits must be one of: ${VALID_STOP_BITS.join(', ')}`)
  if (options.parity !== undefined && !(VALID_PARITY as readonly string[]).includes(options.parity))
    throw new TypeError(`SerialPort parity must be one of: ${VALID_PARITY.join(', ')}`)
}

type NativeModule = typeof import('../index.js')

async function loadNativeModule(): Promise<NativeModule> {
  try {
    return await import('../index.js')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Cannot find native binding')) {
      throw new Error(
        `tiny-serial: No pre-built binary for ${process.platform}-${process.arch}. ` +
          `See https://github.com/max-hans/tiny-serial/issues for help.`,
        { cause: err },
      )
    }
    throw err
  }
}

export class SerialPort extends Readable {
  public readonly path: string
  public isOpen: boolean
  private _options: SerialPortOptions
  private _native: INativeSerialPort | null
  private _nativeImpl: INativeSerialPortClass | null
  private _nativePromise: Promise<INativeSerialPortClass> | null

  constructor(options: SerialPortOptions, _nativeImpl?: INativeSerialPortClass) {
    super()
    validateOptions(options)
    this.path = options.path
    this.isOpen = false
    this._options = options
    this._native = null
    this._nativeImpl = _nativeImpl ?? null
    // Start loading native eagerly so missing-binary errors surface at construction
    // time rather than being deferred until open() is awaited.
    this._nativePromise = _nativeImpl ? null : loadNativeModule().then((m) => m.NativeSerialPort as unknown as INativeSerialPortClass)
  }

  _read(_size: number): void {}

  _destroy(err: Error | null, callback: (err: Error | null) => void): void {
    if (this.isOpen) {
      this.close()
        .then(() => callback(err))
        .catch(() => callback(err))
    } else {
      callback(err)
    }
  }

  async open(): Promise<void> {
    if (this.isOpen) throw new Error('Port is already open')
    const NativeClass = this._nativeImpl ?? (await this._nativePromise!)
    const native = new NativeClass()
    native.open(this._options.path, this._options.baudRate, (err: Error | null, data: Buffer) => {
      if (err) {
        this.emit('error', err)
      } else {
        this.push(data)
      }
    })
    this._native = native
    this.isOpen = true
    this.emit('open')
  }

  async close(): Promise<void> {
    if (!this._native) return
    this._native.close()
    this._native = null
    this.isOpen = false
    this.emit('close')
  }

  async write(chunk: Buffer | string): Promise<void> {
    if (!this._native) throw new Error('Port is not open — call open() first')
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    return this._native.write(buf)
  }

  async drain(): Promise<void> {
    if (!this._native) throw new Error('Port is not open — call open() first')
    return this._native.drain()
  }

  static async list(): Promise<PortInfo[]> {
    const { listPorts } = await loadNativeModule()
    return listPorts() as unknown as PortInfo[]
  }
}
