# tiny-serial

tiny-serial is a serial port library for Node.js and Bun. It uses a thin Rust native layer for OS syscalls, all streams, parsers, and the mock API are written in TypeScript.

## Motivation

This library is strongly inspired by `serialport/node-serialport`. However, it is currently not supported in Bun as documented in various Github issues. The reasons seem to lie in how NodeJS handles native modules (libuv) as opposed to BunJS.

**tiny-serial** uses a new, thin layer written in Rust to circumvent this.

The library is small and doesn't cover the full functionality of serialport, but comes with all the basic functions you would expect.

## Install

```bash
npm install tiny-serial
yarn install tiny-serial
pnpm install tiny-serial
bun add tiny-serial
```

## Usage

```ts
import { SerialPort, ReadlineParser } from 'tiny-serial'

const port = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 9600 })
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }))

parser.on('data', (line) => console.log(line))

await port.write(Buffer.from('hello\n'))
await port.close()
```

## API

### `new SerialPort(options)`

```ts
export interface SerialPortOptions {
  path: string
  baudRate: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'odd' | 'even' | 'mark' | 'space'
  rtscts?: boolean
  xon?: boolean
  xoff?: boolean
  autoOpen?: boolean
}
```

**Methods:** `open()`, `close()`, `write(data)`, `setPin(pin, value)`, `listPorts()`

### Parsers

- **ReadlineParser**: Split on a delimiter string (default `\n`)
- **ByteLengthParser**: Emit fixed-size chunks
- **RegexParser**: Split on a regex match
- **InterByteTimeoutParser**: Emit after a silence gap (ms)

### `MockSerialPort`

Drop-in replacement with no native dependencies — use in tests and CI.

```ts
import { MockSerialPort } from 'tiny-serial'

const mock = new MockSerialPort({ path: '/dev/mock', baudRate: 9600 })
mock.simulateData(Buffer.from('hello\n'))
```

## Development

```bash
bun run build:debug   # Rust (debug) + TypeScript
bun run test          # AVA tests (Node)
bun run test:bun      # bun test
bun run bench         # parser benchmarks
```

Hardware tests require `socat`: `./scripts/test-hardware.sh`

## Performance

Parser benchmarks vs. the `serialport` package:

|     | Task name                                              | Latency avg (ns) | Latency med (ns) | Throughput avg (ops/s) | Throughput med (ops/s) | Samples |
| --- | ------------------------------------------------------ | ---------------- | ---------------- | ---------------------- | ---------------------- | ------- |
| 0   | tiny-serial ReadlineParser — 100 lines × 64 B          | 51297 ± 2.48%    | 47084 ± 1251.0   | 20640 ± 0.13%          | 21239 ± 579            | 19495   |
| 1   | serialport ReadlineParser — 100 lines × 64 B           | 106603 ± 3.73%   | 98959 ± 5041.0   | 9921 ± 0.22%           | 10105 ± 519            | 9381    |
| 2   | tiny-serial ByteLengthParser — 1000 B / 8-byte packets | 9253.0 ± 5.55%   | 8083.0 ± 500.00  | 119869 ± 0.08%         | 123716 ± 8140          | 108074  |
| 3   | serialport ByteLengthParser — 1000 B / 8-byte packets  | 9155.4 ± 1.62%   | 8458.0 ± 500.00  | 114533 ± 0.08%         | 118231 ± 6769          | 109226  |
| 4   | tiny-serial RegexParser — 100 lines × 64 B             | 22288 ± 1.02%    | 20875 ± 1292.0   | 46899 ± 0.11%          | 47904 ± 3051           | 44868   |
| 5   | serialport RegexParser — 100 lines × 64 B              | 28545 ± 0.72%    | 26875 ± 791.00   | 36010 ± 0.10%          | 37209 ± 1119           | 35033   |

## License

MIT
