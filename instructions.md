# tiny-serial

## project description

The Mission
The legacy serialport package is an ecosystem staple, but its deep reliance on C++ and Node-specific libuv polling makes it brittle in modern runtimes like Bun. Our goal is to build a modern, memory-safe, cross-runtime alternative.

We achieve this by completely abandoning libuv polling and adopting a "Thin Native, Fat TypeScript" architecture.

The Architecture
To maintain compatibility across both Node.js and Bun, we split the workload strictly across two boundaries:

The Native Layer (Rust + Node-API): \* Where it lives: src/lib.rs (compiled via napi-rs).

What it does: It only handles OS-level system calls (opening the port, configuring baud rates, and reading/writing bytes).

How it works: When a port opens, Rust spawns a background std::thread that runs a blocking read loop. When bytes arrive, it uses an N-API ThreadSafeFunction to toss the buffer safely back onto the JavaScript event loop. This entirely bypasses the libuv vs. Bun event loop conflicts.

The Stream Layer (TypeScript): \* Where it lives: src/ts/ (or similar).

What it does: Everything else.

How it works: We wrap the Rust bindings in a pure TypeScript class extending stream.Duplex. All stream buffering, state management, configuration parsing, and protocol transforms (like ReadlineParser) happen here in JS-land.

The Tech Stack
TypeScript: For the main library, parsers, and mock API.

Rust: Using the serialport crate for hardware interaction and napi-rs to generate the Node/Bun bindings.

Bun & Node: The target runtimes. Tests must pass in both.

Local Development & Testing Workflow
You do not need physical serial hardware (like USB dongles or Arduinos) to contribute to this project.

1. Testing the TypeScript Layer (The Mocks)
   If you are working on stream parsers, state machines, or the TypeScript API, use our built-in MockSerialPort. It implements the exact same interface as the native port but runs entirely in memory. It includes APIs for fault injection (e.g., mockPort.simulateFault('fragmentation')) to test how your TS code handles edge cases.

2. Testing the Native Rust Layer (Virtual Ports)
   If you are modifying the Rust bridge, you need to test actual OS file descriptors. We use socat to create virtual loopback ports (Null Modems).

Run socat -d -d pty,raw,echo=0 pty,raw,echo=0 in your terminal.

It will output two linked virtual paths (e.g., /dev/ttys001 and /dev/ttys002).

Point the automated test suite at these paths. What you write to one port will be emitted by the other, allowing you to validate the Rust read/write threads.

The CI/CD Pipeline
We use GitHub Actions to cross-compile the Rust code for macOS, Linux, and Windows. Do not commit compiled .node binaries. When you open a PR, the CI will automatically build the Rust layer and run the virtual port tests against it using Ubuntu runners.

Where to Start
If you are new to the codebase, here are the best places to get your hands dirty:

Parsers: We always need more pure-TypeScript stream transformers (e.g., writing a parser for a specific protocol like SLIP or NMEA).

Mock Enhancements: Improving the MockSerialPort to support more complex declarative responses or edge-case simulations.

Rust Refactoring: If you know Rust, look for ways to optimize our ThreadSafeFunction buffer passing to reduce memory allocation overhead.

## implementation plan

This plan is structured to minimize frustration by isolating the Rust complexities early, validating them, and then building the comfortable TypeScript layer on top.

### Milestone 1: Setup and Proof of Concept

The goal here is strictly plumbing. We want to ensure Rust can talk to both Node and Bun before touching any hardware APIs.

- **Tasks:**
  1. Initialize the project using `@napi-rs/cli`.
  2. Configure the `package.json` to define the TypeScript entry points.
  3. Write a dummy Rust function (e.g., `add(a, b)`) and export it.
  4. Write a tiny script to call this function.
- **Test Protocol:**
  - Run `node test-script.js` -> Expect correct output.
  - Run `bun test-script.js` -> Expect correct output.
- **Checkpoint 1:** You have a working build pipeline. Code written in Rust successfully executes in both Javascript runtimes without crashing.

---

### Milestone 2: The Rust Native Core (macOS/Linux focus)

This is the most critical phase. You will implement the hardware bridge using the `serialport` Rust crate and Node-API's ThreadSafeFunctions.

- **Tasks:**
  1. Add the `serialport` crate to `Cargo.toml`.
  2. Define a Rust struct/class exposed to JS (`NativeSerialPort`).
  3. **Implement `open`:** Accepts a path, baud rate, and a Javascript callback. Opens the port and spawns a Rust background thread.
  4. **Implement the Read Loop:** In the background thread, continuously read from the port. When data arrives, use `napi::threadsafe_function` to safely push the `Buffer` to the JS callback.
  5. **Implement `write`:** A native async function (`napi::bindgen_prelude::AsyncTask`) that takes a `Buffer` and writes it to the port off the main thread.
  6. **Implement `close`:** Safely terminate the background thread and drop the port handle.
- **Checkpoint 2:** You can physically plug an FTDI/USB-serial adapter into your Mac, open the port via a raw Bun/Node script, and `console.log` incoming bytes as they arrive.

---

### Milestone 3: The "Fat" TypeScript Layer

Here, you wrap the raw Rust bindings in a familiar, user-friendly Node.js Stream API.

- **Tasks:**
  1. Create a `SerialPort` class that extends `stream.Duplex`.
  2. Map user configurations (e.g., `{ path: string, baudRate: number, parity: 'none' | 'even' | 'odd' }`) to the arguments expected by the native layer.
  3. Implement `_read()`: This is often a no-op in this architecture, as data is proactively pushed from the Rust ThreadSafeFunction into the stream via `this.push(data)`.
  4. Implement `_write(chunk, encoding, callback)`: Route incoming stream chunks to your native `write` function, triggering the `callback()` when the native write resolves.
  5. Create parsers (optional but recommended): Implement standard stream transforms like `ReadlineParser` or `ByteLengthParser` in pure TypeScript.
- **Checkpoint 3:** You can pipe standard Node streams into your serial port. (e.g., `fs.createReadStream('file.txt').pipe(mySerialPort)`).

---

### Milestone 4: Automated Testing Protocol

Because serial ports require hardware, automated testing requires creating virtual loopback devices (Null Modems).

- **Environment Setup:** Install `socat` on macOS/Linux (e.g., `brew install socat`). This creates two linked virtual serial ports (e.g., `/dev/ttys01` linked to `/dev/ttys02`). Data written to one comes out the other.

**Test Matrix:**

| Test Category       | Protocol / Action                                                          | Expected Outcome                                                                                 |
| :------------------ | :------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| **Configuration**   | Pass invalid baud rates, missing paths, or wrong parity to TS constructor. | Synchronous TS error thrown; native code is never reached.                                       |
| **Loopback (Core)** | Open linked virtual ports. Write "HELLO" to Port A. Read from Port B.      | Port B emits "HELLO" buffer. Must pass in both Node and Bun.                                     |
| **Concurrency**     | Perform 100 rapid `write()` calls to a virtual port.                       | No dropped bytes; native async worker queue handles the load without blocking the JS event loop. |
| **Teardown**        | Open port, read/write, close port, and immediately attempt to reopen.      | Port closes cleanly without hanging the process or leaving orphaned Rust threads.                |

- **Checkpoint 4:** A unified test suite (using a runner like `vitest` or `bun test`) passes 100% on a local machine using virtual ports.

---

### Milestone 5: Cross-Platform CI Compilation

You do not want users compiling Rust on `npm install`. You must distribute pre-compiled binaries for major architectures.

- **Tasks:**
  1. Utilize the GitHub Actions workflow automatically generated by `@napi-rs/cli`.
  2. Configure the build matrix to compile for:
     - `x86_64-apple-darwin` (macOS Intel)
     - `aarch64-apple-darwin` (macOS Apple Silicon)
     - `x86_64-unknown-linux-gnu` (Linux standard)
     - `x86_64-pc-windows-msvc` (Windows standard)
  3. Modify your CI test step to run the virtual loopback tests on the Ubuntu runner (using `socat` installed via `apt-get`).
- **Checkpoint 5:** GitHub Actions successfully compiles `.node` binaries for all target OS platforms upon pushing to the `main` branch.

---

### Milestone 6: Deployment & Publishing

Napi-rs provides a great mechanism for distributing cross-platform packages using NPM's `optionalDependencies` pattern.

- **Deployment Strategy:**
  1. Your CI pipeline will publish several scoped packages containing just the compiled binaries (e.g., `@yourname/serialport-darwin-arm64`, `@yourname/serialport-linux-x64`).
  2. It will then publish your main package (the pure TypeScript wrapper).
  3. The main package's `package.json` dynamically loads the correct binary at runtime based on the user's OS and architecture (`process.platform` and `process.arch`).
- **Final Checkpoint:** You can run `bun install your-package` on a completely clean machine with no Rust or Python installed, and it works perfectly out of the box.

---

## mock modules

You are absolutely right to focus on the mock module. In the original `serialport` package, `@serialport/binding-mock` is a lifesaver for CI/CD environments and automated testing, because relying on physical hardware for unit tests is a nightmare.

However, the original mock API has a distinct flaw: it is deeply coupled to their internal `Binding` architecture. To use it, you have to globally override the binding or pass complex configuration objects, which feels clunky.

Since you are building a "Fat TypeScript, Thin Native" architecture, your mock implementation doesn't need to emulate low-level C++ bindings at all. It just needs to emulate the TypeScript `Duplex` stream behavior.

Here is an analysis of how you can design a simpler, yet significantly more powerful `MockSerialPort` alternative.

### 1. Drop-In Dependency Injection (No Binding Boilerplate)

The original package forces you to interact with an abstract `Binding` class. Your alternative should just be a class that shares the exact same interface as your real `SerialPort` class.

- **The Feature:** Export a `MockSerialPort` class that extends your same internal base class or implements the same interface.
- **Why it's better:** Users can easily swap the real port for the mock port using standard dependency injection in their tests, without polluting global state or tweaking complex internal binding factories.

### 2. Declarative Request/Response Simulation

In the original mock, if you want the "device" to respond to a command, you have to manually wire up listeners and call `binding.emitData()`.

- **The Feature:** Add a `.mockReply(trigger, response, delay?)` method.
- **Why it's better:** Most serial devices use a request/response protocol (like AT commands). You can let users script the simulated hardware declaratively:
  ```typescript
  // When the port receives "AT\r", it automatically replies with "OK\r" after 10ms
  mockPort.mockReply(Buffer.from('AT\r'), Buffer.from('OK\r'), 10)
  ```

### 3. Built-In Stream Inspection (The "Spy" Feature)

Testing serial data usually involves writing to the port and asserting that the correct bytes were sent. Currently, developers have to attach their own stream interceptors to verify what was written.

- **The Feature:** Include a `.getWrittenData()` method or a `.writtenHistory` array directly on the mock instance.
- **Why it's better:** It makes writing assertions in Vitest or Jest incredibly simple and synchronous.
  ```typescript
  await port.write('TURN_ON_LED')
  expect(mockPort.getWrittenData()).toEqual(Buffer.from('TURN_ON_LED'))
  ```

### 4. Deterministic Fault Injection

Real hardware fails. Wires get loose, buffers overflow, and devices restart. The original mock can simulate disconnects, but simulating latency or partial packets is tedious.

- **The Feature:** Add a `.simulateFault(type)` API.
- **Why it's better:** You can give developers a one-line tool to test how robust their parsers and state machines are.
  - `mockPort.simulateFault('disconnect')`: Emits a standard closed/error event.
  - `mockPort.simulateFault('fragmentation')`: Forces the mock port to split all incoming replies into 1-byte chunks, testing if the user's stream parser correctly reassembles fragmented data.
  - `mockPort.simulateFault('timeout')`: Temporarily stops all `.mockReply` responses.

### 5. Virtual Hardware Pin Manipulation

Serial communication isn't just data; it's also control lines (DTR, RTS, CTS, DCD).

- **The Feature:** Simple getter/setter methods for the mock hardware pins that trigger standard events.
- **Why it's better:** Instead of complex binding calls, the user can just flip a boolean to simulate a device pulling a line high or low.
  ```typescript
  // Simulates the hardware device asserting the Clear To Send pin
  mockPort.pins.setCTS(true)
  ```

### Summary of the API Architecture

To achieve this, your TypeScript layer would look something like this:

1.  **`ISerialPort` (Interface):** Defines the standard methods (`write`, `read`, `close`, `setPins`).
2.  **`NativeSerialPort` (Class):** Implements `ISerialPort`, wraps the Rust Node-API calls.
3.  **`MockSerialPort` (Class):** Implements `ISerialPort`, uses pure TypeScript arrays and `setTimeout` to fulfill the contract, adding the specific mock methods (`mockReply`, `simulateFault`) for testing.

---

## examples

Practical, real-world examples of how developers will configure the port and compose parsers to handle specific, well-known communication protocols.

When developers use a serial port library, they are almost always trying to translate raw streams of bytes into meaningful application messages. To make your library powerful, offering a robust set of **Transform Streams (Parsers)** out-of-the-box is just as important as the native hardware bindings.

Here are three distinct, real-world use cases demonstrating how your module would be configured to handle different industry-standard protocols.

### Use Case 1: Marine / GPS Navigation (NMEA 0183 Protocol)

**The Protocol:** GPS modules constantly stream text-based data called NMEA sentences. These are comma-separated ASCII strings that always start with a `$` and end with a carriage return and line feed (`\r\n`).
**The Configuration:** Legacy GPS devices run at very slow speeds and use standard "8N1" settings (8 data bits, No parity, 1 stop bit).
**The Parser:** `ReadlineParser`

```typescript
import { SerialPort, ReadlineParser } from '@yourname/serialport'

// 1. Configure the hardware specifically for a legacy GPS module
const port = new SerialPort({
  path: '/dev/ttyACM0',
  baudRate: 4800,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
})

// 2. Attach a parser that buffers incoming bytes until it sees "\r\n"
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))

// 3. Consume clean, complete sentences
parser.on('data', (sentence: string) => {
  if (sentence.startsWith('$GPGGA')) {
    const parts = sentence.split(',')
    console.log(`Latitude: ${parts[2]}, Longitude: ${parts[4]}`)
  }
})
```

_Why this API works well:_ The user doesn't have to worry about the fact that a 75-byte GPS sentence might arrive in five separate 15-byte chunks from the OS buffer. The `ReadlineParser` handles the buffering internally.

---

### Use Case 2: Industrial Automation (Modbus RTU Protocol)

**The Protocol:** Modbus RTU is a binary protocol used by PLCs and motor controllers. Unlike ASCII protocols, there are no `\n` characters to mark the end of a message. Instead, the protocol strictly dictates that a message frame is complete when there is a **silent gap of at least 3.5 character times** on the wire.
**The Configuration:** Industrial setups often use "Even" parity to detect bit-flips caused by electrical noise on factory floors.
**The Parser:** `InterByteTimeoutParser`

```typescript
import { SerialPort, InterByteTimeoutParser } from '@yourname/serialport'

const port = new SerialPort({
  path: 'COM4',
  baudRate: 19200,
  dataBits: 8,
  parity: 'even', // Common in Modbus
  stopBits: 1,
})

// 2. Attach a parser that flushes its buffer if 10ms passes without a new byte
// 10ms is a safe threshold for the Modbus 3.5 character silence at 19200 baud
const parser = port.pipe(new InterByteTimeoutParser({ interval: 10 }))

parser.on('data', (frame: Buffer) => {
  const slaveAddress = frame[0]
  const functionCode = frame[1]

  if (functionCode === 0x03) {
    console.log(`Received sensor data from Slave ${slaveAddress}:`, frame.subarray(2, -2))
  }
})
```

_Why this API works well:_ Writing a timeout-based buffer in pure JavaScript is notoriously tricky due to event-loop lag. By providing a battle-tested `InterByteTimeoutParser`, you save automation engineers hours of debugging dropped binary frames.

---

### Use Case 3: Cellular/IoT Modems (AT Commands with Hardware Flow Control)

**The Protocol:** Communicating with a 4G/5G modem or Bluetooth module uses AT Commands. It is an interactive request/response protocol. Sometimes it responds with `OK\r\n`, but if you are sending an SMS, it might prompt you with `> ` and wait for your text.
**The Configuration:** Modems can send massive amounts of data fast. To prevent the modem from overflowing the computer's serial buffer, you must enable **Hardware Flow Control (RTS/CTS)**.
**The Parser:** `RegexParser`

```typescript
import { SerialPort, RegexParser } from '@yourname/serialport'

const port = new SerialPort({
  path: '/dev/ttyUSB2',
  baudRate: 115200,
  rtscts: true, // Hardware flow control enabled! The OS handles signaling the modem to pause.
})

// 2. Use a RegexParser because the delimiter changes based on context.
// It will yield data when it sees a standard line ending OR a text prompt.
const parser = port.pipe(new RegexParser({ regex: /(?:\r\n)|(?:> )/ }))

// 3. Simple async wrapper to send commands and await the next parsed chunk
async function sendATCommand(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    parser.once('data', (response) => resolve(response.toString().trim()))
    port.write(`${cmd}\r`)
  })
}

// Usage Example
port.on('open', async () => {
  const status = await sendATCommand('AT')
  console.log('Modem Status:', status) // Expected: "OK"

  await sendATCommand('AT+CMGS="+1234567890"') // Start SMS
  // The parser yields because it hits the "> " prompt regex
  port.write('Hello from Bun/Node!\x1A') // \x1A is CTRL+Z to send
})
```

_Why this API works well:_ The combination of `rtscts: true` passed directly down to the native Rust layer guarantees the OS won't drop bytes during heavy cellular downloads, while the `RegexParser` provides the flexibility needed for quirky command-line interfaces.
