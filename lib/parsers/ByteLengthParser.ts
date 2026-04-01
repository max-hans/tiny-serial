import { Transform, TransformOptions } from 'node:stream'

export interface ByteLengthParserOptions extends TransformOptions {
  length: number
}

export class ByteLengthParser extends Transform {
  private _buffer: Buffer
  private _length: number

  constructor(options: ByteLengthParserOptions) {
    super(options)
    if (!options.length || options.length < 1) {
      throw new TypeError('ByteLengthParser requires a length of at least 1')
    }
    this._length = options.length
    this._buffer = Buffer.alloc(0)
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    // 1. Skip concat entirely if we don't have leftover data
    let data = this._buffer.length === 0 ? chunk : Buffer.concat([this._buffer, chunk])

    // 2. Cache variables locally so V8/JavaScriptCore doesn't have to do class property lookups 125 times
    let offset = 0
    const targetLength = this._length

    // 3. Creeping offset: No remainder allocations inside the loop!
    while (offset + targetLength <= data.length) {
      this.push(data.subarray(offset, offset + targetLength))
      offset += targetLength
    }

    // 4. Slice the remainder exactly ONCE at the end of the transform cycle
    this._buffer = offset < data.length ? data.subarray(offset) : Buffer.alloc(0)

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
