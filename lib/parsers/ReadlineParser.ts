import { Transform, TransformOptions } from 'node:stream'

export interface ReadlineParserOptions extends TransformOptions {
  delimiter?: string | Buffer
  encoding?: BufferEncoding
  includeDelimiter?: boolean
}

export class ReadlineParser extends Transform {
  private _buffer: Buffer
  private _delimiter: Buffer
  private _includeDelimiter: boolean

  constructor(options: ReadlineParserOptions = {}) {
    super(options)
    const delimiter = options.delimiter ?? '\n'
    this._delimiter = typeof delimiter === 'string' ? Buffer.from(delimiter, options.encoding ?? 'utf8') : delimiter
    this._includeDelimiter = options.includeDelimiter ?? false
    this._buffer = Buffer.alloc(0)
    if (this._delimiter.length === 0) {
      throw new TypeError('ReadlineParser delimiter must not be empty')
    }
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this._buffer = Buffer.concat([this._buffer, chunk])
    let position: number
    while ((position = this._buffer.indexOf(this._delimiter)) !== -1) {
      const end = position + (this._includeDelimiter ? this._delimiter.length : 0)
      const line = this._buffer.subarray(0, end)
      this._buffer = this._buffer.subarray(position + this._delimiter.length)
      this.push(line)
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
