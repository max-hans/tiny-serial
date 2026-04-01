import { Transform, TransformOptions } from 'node:stream'

export interface InterByteTimeoutParserOptions extends TransformOptions {
  interval: number
  maxBufferSize?: number
}

export class InterByteTimeoutParser extends Transform {
  private _buffer: Buffer
  private _timeout: ReturnType<typeof setTimeout> | null
  private _interval: number
  private _maxBufferSize: number

  constructor(options: InterByteTimeoutParserOptions) {
    super(options)
    if (!options.interval || options.interval < 1) {
      throw new TypeError('InterByteTimeoutParser requires an interval of at least 1ms')
    }
    this._interval = options.interval
    this._maxBufferSize = options.maxBufferSize ?? 65536
    this._buffer = Buffer.alloc(0)
    this._timeout = null
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    if (this._timeout !== null) {
      clearTimeout(this._timeout)
    }
    this._buffer = Buffer.concat([this._buffer, chunk])
    if (this._buffer.length >= this._maxBufferSize) {
      this.push(this._buffer)
      this._buffer = Buffer.alloc(0)
      this._timeout = null
    } else {
      this._timeout = setTimeout(() => {
        this.push(this._buffer)
        this._buffer = Buffer.alloc(0)
        this._timeout = null
      }, this._interval)
    }
    callback()
  }

  _flush(callback: () => void): void {
    if (this._timeout !== null) {
      clearTimeout(this._timeout)
      this._timeout = null
    }
    if (this._buffer.length > 0) {
      this.push(this._buffer)
      this._buffer = Buffer.alloc(0)
    }
    callback()
  }
}
