import { Transform, type TransformOptions } from 'node:stream'

export interface ByteLengthParserOptions extends TransformOptions {
  length: number
}

export class ByteLengthParser extends Transform {
  private _buffer: Buffer = Buffer.alloc(0)
  private _length: number

  constructor(options: ByteLengthParserOptions) {
    super(options)
    if (!options.length || options.length < 1) {
      throw new TypeError('ByteLengthParser requires a length of at least 1')
    }
    this._length = options.length
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    // 1. Single Concat (Fastest way in Bun to get a contiguous view)
    const data = this._buffer.length === 0 ? chunk : Buffer.concat([this._buffer, chunk])

    const len = this._length
    const dataLen = data.length
    let offset = 0

    // 2. The Tightest Possible Loop
    // We avoid property lookups by using local 'len' and 'dataLen'
    while (offset + len <= dataLen) {
      this.push(data.subarray(offset, offset + len))
      offset += len
    }

    // 3. Keep the remainder
    this._buffer = offset < dataLen ? data.subarray(offset) : Buffer.alloc(0)

    callback()
  }

  _flush(callback: () => void): void {
    if (this._buffer.length > 0) {
      this.push(this._buffer)
      this._buffer = Buffer.alloc(0)
    }
    callback()
  }
}
