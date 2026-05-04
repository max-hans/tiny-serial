import { Readable } from 'node:stream'
import type { SerialPortOptions, PinName } from '../types.js'

type FaultType = 'disconnect' | 'fragmentation' | 'timeout'

interface MockReply {
  trigger: Buffer
  response: Buffer
  delay: number
}

export interface MockPins {
  setCTS(value: boolean): void
  setDSR(value: boolean): void
  setDCD(value: boolean): void
  getCTS(): boolean
  getDSR(): boolean
  getDCD(): boolean
}

function toBuffer(value: Buffer | string): Buffer {
  return typeof value === 'string' ? Buffer.from(value) : value
}

export class MockSerialPort extends Readable {
  public readonly path: string
  public isOpen: boolean
  public readonly pins: MockPins

  private _written: Buffer[]
  private _replies: MockReply[]
  private _faults: Set<FaultType>
  private _pinState: Record<string, boolean>

  constructor(options: SerialPortOptions) {
    super()
    this.path = options.path
    this.isOpen = false
    this._written = []
    this._replies = []
    this._faults = new Set()
    this._pinState = { CTS: false, DSR: false, DCD: false }

    /* oxlint-disable */
    const self = this
    this.pins = {
      setCTS(value: boolean) {
        self._pinState['CTS'] = value
        self.emit('pin-change', { pin: 'CTS' as PinName, value })
      },
      setDSR(value: boolean) {
        self._pinState['DSR'] = value
        self.emit('pin-change', { pin: 'DSR' as PinName, value })
      },
      setDCD(value: boolean) {
        self._pinState['DCD'] = value
        self.emit('pin-change', { pin: 'DCD' as PinName, value })
      },
      getCTS() {
        return self._pinState['CTS']
      },
      getDSR() {
        return self._pinState['DSR']
      },
      getDCD() {
        return self._pinState['DCD']
      },
    }
  }

  _read(_size: number): void {}

  async open(): Promise<void> {
    this.isOpen = true
    this.emit('open')
  }

  async close(): Promise<void> {
    this.isOpen = false
    this.emit('close')
  }

  async drain(): Promise<void> {}

  async write(chunk: Buffer | string): Promise<void> {
    const buf = toBuffer(chunk)
    this._written.push(Buffer.from(buf))

    if (!this._faults.has('timeout')) {
      for (const reply of this._replies) {
        if (buf.includes(reply.trigger)) {
          setTimeout(() => this._injectData(reply.response), reply.delay)
          break
        }
      }
    }
  }

  mockReply(trigger: Buffer | string, response: Buffer | string, delay = 0): this {
    this._replies.push({ trigger: toBuffer(trigger), response: toBuffer(response), delay })
    return this
  }

  getWrittenData(): Buffer {
    return Buffer.concat(this._written)
  }

  clearWrittenData(): this {
    this._written = []
    return this
  }

  simulateFault(type: FaultType): this {
    if (type === 'disconnect') {
      this.isOpen = false
      this.push(null)
      this.emit('close')
    } else {
      this._faults.add(type)
    }
    return this
  }

  clearFault(type: FaultType): this {
    this._faults.delete(type)
    return this
  }

  _injectData(data: Buffer): void {
    if (this._faults.has('fragmentation')) {
      for (let i = 0; i < data.length; i++) {
        const byte = data.subarray(i, i + 1)
        setImmediate(() => this.push(byte))
      }
    } else {
      this.push(data)
    }
  }
}
