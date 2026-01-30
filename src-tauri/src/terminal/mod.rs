use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct TerminalManager {
    pty_pair: Option<Arc<Mutex<PtyPair>>>,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            pty_pair: None,
            writer: None,
        }
    }

    pub fn spawn(&mut self, app: AppHandle) -> Result<(), String> {
        if self.pty_pair.is_some() {
            return Ok(());
        }

        let pty_system = NativePtySystem::default();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let cmd = CommandBuilder::new("bash");
        let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        self.writer = Some(Arc::new(Mutex::new(writer)));
        self.pty_pair = Some(Arc::new(Mutex::new(pair)));

        // Spawn read thread
        thread::spawn(move || {
            let mut buffer = [0u8; 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(n) if n > 0 => {
                        let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = app.emit("term-data", data);
                    }
                    Ok(_) => break, // EOF
                    Err(_) => break,
                }
            }
        });

        Ok(())
    }

    pub fn write(&self, data: String) -> Result<(), String> {
        if let Some(writer) = &self.writer {
            let mut w = writer.lock().map_err(|_| "Failed to lock writer")?;
            w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        if let Some(pair) = &self.pty_pair {
            let p = pair.lock().map_err(|_| "Failed to lock pty")?;
            p.master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
