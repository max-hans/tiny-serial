#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[napi(object)]
pub struct PortInfo {
  pub path: String,
  pub port_type: String,
}

#[napi]
pub fn list_ports() -> napi::Result<Vec<PortInfo>> {
  serialport::available_ports()
    .map_err(|e| napi::Error::from_reason(e.to_string()))
    .map(|ports| {
      ports
        .into_iter()
        .map(|p| PortInfo {
          path: p.port_name,
          port_type: format!("{:?}", p.port_type),
        })
        .collect()
    })
}

pub struct WriteTask {
  writer: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
  data: Vec<u8>,
}

impl Task for WriteTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> napi::Result<()> {
    use std::io::Write;
    let mut guard = self
      .writer
      .lock()
      .map_err(|_| napi::Error::from_reason("Lock poisoned"))?;
    match guard.as_mut() {
      Some(port) => port
        .write_all(&self.data)
        .map_err(|e| napi::Error::from_reason(e.to_string())),
      None => Err(napi::Error::from_reason("Port is not open")),
    }
  }

  fn resolve(&mut self, _env: Env, _output: ()) -> napi::Result<()> {
    Ok(())
  }
}

pub struct DrainTask {
  writer: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
}

impl Task for DrainTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> napi::Result<()> {
    use std::io::Write;
    let mut guard = self
      .writer
      .lock()
      .map_err(|_| napi::Error::from_reason("Lock poisoned"))?;
    match guard.as_mut() {
      Some(port) => port
        .flush()
        .map_err(|e| napi::Error::from_reason(e.to_string())),
      None => Err(napi::Error::from_reason("Port is not open")),
    }
  }

  fn resolve(&mut self, _env: Env, _output: ()) -> napi::Result<()> {
    Ok(())
  }
}

#[napi]
pub struct NativeSerialPort {
  writer: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
  stop_flag: Arc<AtomicBool>,
  reader_thread: Mutex<Option<thread::JoinHandle<()>>>,
}

impl Default for NativeSerialPort {
  fn default() -> Self {
    Self::new()
  }
}

#[napi]
impl NativeSerialPort {
  #[napi(constructor)]
  pub fn new() -> Self {
    NativeSerialPort {
      writer: Arc::new(Mutex::new(None)),
      stop_flag: Arc::new(AtomicBool::new(false)),
      reader_thread: Mutex::new(None),
    }
  }

  /// Open a serial port and start reading in a background thread.
  /// The data_callback is called with (null, Buffer) on data or (Error, null) on error.
  #[napi]
  pub fn open(
    &self,
    env: Env,
    path: String,
    baud_rate: u32,
    mut data_callback: ThreadsafeFunction<Buffer>,
  ) -> napi::Result<()> {
    // Bun NAPI bug: thread_finalize_cb is called with null finalize_hint (the context pointer),
    // causing Box::from_raw(null) to panic inside napi-rs. Workaround: unref the TSF so it
    // doesn't prevent event loop exit, then forget() it on every exit path so
    // napi_release_threadsafe_function is never called and the finalizer never fires.
    // unref() is deprecated in favour of the Weak const generic, but napi-derive constructs
    // the TSF before passing it here so we cannot control the generic at the call site.
    #[allow(deprecated)]
    let _ = data_callback.unref(&env);

    // RAII guard: ensures the TSF is forgotten (not dropped) on every exit path.
    struct ForgetGuard<T>(Option<T>);
    impl<T> Drop for ForgetGuard<T> {
      fn drop(&mut self) {
        if let Some(v) = self.0.take() {
          std::mem::forget(v);
        }
      }
    }
    let mut cb_guard = ForgetGuard(Some(data_callback));

    let port = serialport::new(&path, baud_rate)
      .timeout(Duration::from_millis(10))
      .open()
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut reader = port
      .try_clone()
      .map_err(|e| napi::Error::from_reason(e.to_string()))?;

    {
      let mut guard = self
        .writer
        .lock()
        .map_err(|_| napi::Error::from_reason("Lock poisoned"))?;
      *guard = Some(port);
    }

    // Reset stop flag in case port is being re-opened
    self.stop_flag.store(false, Ordering::SeqCst);
    let stop_flag = self.stop_flag.clone();
    // Extract TSF from guard for the thread; guard is now empty and will noop on drop
    let data_callback = cb_guard.0.take().unwrap();

    let handle = thread::spawn(move || {
      let mut buf = vec![0u8; 4096];
      loop {
        if stop_flag.load(Ordering::Relaxed) {
          break;
        }
        match reader.read(&mut buf) {
          Ok(0) => {}
          Ok(n) => {
            let data = Buffer::from(buf[..n].to_vec());
            data_callback.call(Ok(data), ThreadsafeFunctionCallMode::NonBlocking);
          }
          Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
            // Expected with 10ms timeout — allows checking stop_flag regularly
          }
          Err(e) => {
            if !stop_flag.load(Ordering::Relaxed) {
              data_callback.call(
                Err(napi::Error::from_reason(e.to_string())),
                ThreadsafeFunctionCallMode::NonBlocking,
              );
            }
            break;
          }
        }
      }
      std::mem::forget(data_callback);
    });

    *self
      .reader_thread
      .lock()
      .map_err(|_| napi::Error::from_reason("Lock poisoned"))? = Some(handle);

    Ok(())
  }

  /// Write bytes to the port asynchronously (off the main thread).
  #[napi]
  pub fn write(&self, data: Buffer) -> AsyncTask<WriteTask> {
    AsyncTask::new(WriteTask {
      writer: self.writer.clone(),
      data: data.to_vec(),
    })
  }

  /// Drain the output buffer (blocks until all bytes are transmitted).
  #[napi]
  pub fn drain(&self) -> AsyncTask<DrainTask> {
    AsyncTask::new(DrainTask {
      writer: self.writer.clone(),
    })
  }

  /// Close the port and signal the background reader thread to exit.
  #[napi]
  pub fn close(&self) -> napi::Result<()> {
    self.stop_flag.store(true, Ordering::SeqCst);
    {
      let mut guard = self
        .writer
        .lock()
        .map_err(|_| napi::Error::from_reason("Lock poisoned"))?;
      if let Some(port) = guard.as_mut() {
        // Unblocks the blocking read so the thread can exit cleanly
        let _ = port.clear(serialport::ClearBuffer::All);
      }
      *guard = None;
    }
    // Join the reader thread so the TIOCEXCL exclusive lock is fully released
    // before this call returns. The thread exits within one poll timeout (~10ms).
    let handle = self
      .reader_thread
      .lock()
      .map_err(|_| napi::Error::from_reason("Lock poisoned"))?
      .take();
    if let Some(handle) = handle {
      let _ = handle.join();
    }
    Ok(())
  }
}
