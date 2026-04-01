import { Transform, TransformOptions } from 'node:stream'

export interface RegexParserOptions extends TransformOptions {
  regex: RegExp
  encoding?: BufferEncoding
}

export class RegexParser extends Transform {
  private _buffer: string
  private _regex: RegExp
  private _encoding: BufferEncoding

  constructor(options: RegexParserOptions) {
    super(options)
    if (!options.regex) {
      throw new TypeError('RegexParser requires a regex option')
    }
    // Ensure regex has the global flag so exec advances lastIndex
    const flags = options.regex.flags.includes('g') ? options.regex.flags : options.regex.flags + 'g'
    this._regex = new RegExp(options.regex.source, flags)
    this._encoding = options.encoding ?? 'utf8'
    this._buffer = ''
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this._buffer += chunk.toString(this._encoding)
    let match: RegExpExecArray | null
    let lastIndex = 0
    this._regex.lastIndex = 0
    while ((match = this._regex.exec(this._buffer)) !== null) {
      this.push(this._buffer.substring(lastIndex, match.index + match[0].length))
      lastIndex = match.index + match[0].length
      if (match[0].length === 0) {
        // Avoid infinite loop on zero-length match
        this._regex.lastIndex++
      }
    }
    this._buffer = this._buffer.substring(lastIndex)
    callback()
  }

  _flush(callback: () => void): void {
    if (this._buffer.length > 0) {
      this.push(this._buffer)
      this._buffer = ''
    }
    callback()
  }
}
