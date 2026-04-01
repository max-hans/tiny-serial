# bun-serial — Milestone Handoff

## Done

### M1 — Proof of Concept ✅
napi-rs project initialized. Rust builds and the native `.node` binary loads in both Node.js and Bun.

### M2 — Rust Native Core ✅
`src/lib.rs` implements `NativeSerialPort`:
- `open(path, baudRate, callback)` — opens port via `serialport` crate, spawns a background `std::thread` that reads in a loop and pushes data to JS via `Arc<ThreadsafeFunction<Buffer>>` (napi v3). Uses `try_clone()` so the reader owns its handle with no lock contention.
- `write(data)` — async write via `AsyncTask` (off the JS thread).
- `close()` — sets an `AtomicBool` stop flag and calls `clear(ClearBuffer::All)` to unblock the blocking read so the thread exits cleanly.
- `list_ports()` — wraps `serialport::available_ports()`.

### M3 — TypeScript Layer ✅
`lib/` directory:
- `SerialPort` — extends `stream.Duplex`, wraps `NativeSerialPort`. Validates options synchronously; native binding is lazy-loaded via `import()` (works in both ESM tests and CJS compiled output).
- `ReadlineParser` — buffers until delimiter (default `\n`).
- `ByteLengthParser` — emits exactly N bytes.
- `InterByteTimeoutParser` — emits when no bytes arrive within interval ms.
- `RegexParser` — emits when regex matches accumulated string data.
- `MockSerialPort` — pure-TS Duplex with `mockReply()`, `getWrittenData()`, `simulateFault()`, `clearFault()`, and `pins` API.

### M4 — Testing ✅
- 34 AVA tests (Node.js) — all pass. No hardware required.
- 9 bun tests (Bun) — all pass.
- Native integration tests in `__test__/native.spec.ts` skip gracefully without virtual ports; run with `./scripts/test-hardware.sh`.

---

## Remaining

### M5 — Cross-Platform CI ⬜
The napi-rs GitHub Actions workflow at `.github/workflows/CI.yml` is auto-generated and targets macOS, Linux, and Windows. **No code changes needed** — just push to GitHub. The Android target was already removed from `package.json` because `serialport` doesn't support it.

One thing to verify: the CI test step should run `./scripts/test-hardware.sh` with `socat` installed via `apt-get install socat` on the Ubuntu runner. The existing CI only runs `ava` without virtual ports. Update the test step in `CI.yml` if loopback tests are desired in CI.

### M6 — Publishing ⬜
napi-rs handles the multi-platform npm publish pattern automatically:
1. Run `bun run build` (release mode).
2. Run `napi prepublish -t npm` to create platform-specific package directories.
3. Publish platform packages first (`@bun-serial/linux-x64`, etc.), then publish the main package.

The `serial.js` / `serial.d.ts` user-facing entry point and the `"exports"` field in `package.json` are already set up.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib.rs` | Rust native core — the only file that touches the OS serial API |
| `lib/SerialPort.ts` | Main user-facing class (stream.Duplex wrapper) |
| `lib/mock/MockSerialPort.ts` | Test mock — no native dependency |
| `lib/parsers/` | Pure-TS stream transformers |
| `lib/index.ts` | Barrel export |
| `serial.js` / `serial.d.ts` | Public entry point (hand-authored, points to `dist/`) |
| `index.js` / `index.d.ts` | **napi-rs owned** — do not hand-edit, regenerated on every build |
| `scripts/test-hardware.sh` | Runs native tests with socat virtual loopback ports |

## Build Commands

```bash
bun run build:debug   # Rust (debug) + TypeScript
bun run build         # Rust (release) + TypeScript
bun run build:ts      # TypeScript only (tsc)
bun run test          # AVA tests (Node, no hardware needed)
bun run test:bun      # bun:test (Bun, no hardware needed)
./scripts/test-hardware.sh        # native tests with virtual ports
./scripts/test-hardware.sh --all  # full suite + native
```
