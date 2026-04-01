import { Transform, type TransformOptions } from 'node:stream'

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
    this._delimiter =
      typeof delimiter === 'string' ? Buffer.from(delimiter, (options.encoding as BufferEncoding) ?? 'utf8') : delimiter
    this._includeDelimiter = options.includeDelimiter ?? false
    this._buffer = Buffer.alloc(0)
    if (this._delimiter.length === 0) {
      throw new TypeError('ReadlineParser delimiter must not be empty')
    }
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    // 1. Combine leftover from previous tick
    const data = this._buffer.length === 0 ? chunk : Buffer.concat([this._buffer, chunk])

    const delimiter = this._delimiter
    const delimLen = delimiter.length
    const includeDelim = this._includeDelimiter

    let searchIndex = 0
    let cursor = 0

    // 2. Linear scan: Use indexOf with a start offset to avoid re-slicing
    while (true) {
      const position = data.indexOf(delimiter, searchIndex)
      if (position === -1) break

      // Calculate where the emitted chunk ends
      const end = position + (includeDelim ? delimLen : 0)
      this.push(data.subarray(cursor, end))

      // Move the cursor to the start of the NEXT potential line
      cursor = position + delimLen
      searchIndex = cursor
    }

    // 3. One single slice for the leftover data
    this._buffer = cursor < data.length ? data.subarray(cursor) : Buffer.alloc(0)

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
