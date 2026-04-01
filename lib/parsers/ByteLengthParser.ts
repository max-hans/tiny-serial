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
    this._buffer = Buffer.concat([this._buffer, chunk])
    while (this._buffer.length >= this._length) {
      const packet = this._buffer.subarray(0, this._length)
      this._buffer = this._buffer.subarray(this._length)
      this.push(packet)
    }
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
