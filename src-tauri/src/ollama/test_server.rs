//! A tiny scripted HTTP server used to mock Ollama in tests.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

pub struct MockResponse {
    status: u16,
    /// `None` means accept the connection but never answer.
    chunks: Option<Vec<Vec<u8>>>,
    hold_open: Duration,
}

impl MockResponse {
    pub fn json(status: u16, body: &str) -> Self {
        Self::chunked(status, vec![body.as_bytes().to_vec()])
    }

    pub fn chunked(status: u16, chunks: Vec<Vec<u8>>) -> Self {
        Self {
            status,
            chunks: Some(chunks),
            hold_open: Duration::ZERO,
        }
    }

    pub fn silent() -> Self {
        Self {
            status: 200,
            chunks: None,
            hold_open: Duration::from_secs(10),
        }
    }

    /// Keep the connection open (without sending more data) after the chunks.
    pub fn hold_open(mut self, duration: Duration) -> Self {
        self.hold_open = duration;
        self
    }
}

pub type Requests = Arc<Mutex<Vec<String>>>;

async fn read_request(socket: &mut TcpStream) -> String {
    let mut data = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = socket.read(&mut buf).await.unwrap_or(0);
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        if let Some(header_end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&data[..header_end]).to_lowercase();
            let content_length = headers
                .lines()
                .find_map(|l| l.strip_prefix("content-length:"))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if data.len() >= header_end + 4 + content_length {
                break;
            }
        }
    }
    String::from_utf8_lossy(&data).into_owned()
}

/// Serve the scripted responses, one per connection, in order. Returns the
/// base URL and a log of raw requests received.
pub async fn serve(responses: Vec<MockResponse>) -> (String, Requests) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let requests: Requests = Arc::default();
    let log = requests.clone();
    tokio::spawn(async move {
        for response in responses {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut socket).await;
            log.lock().await.push(request);
            let Some(chunks) = response.chunks else {
                tokio::time::sleep(response.hold_open).await;
                continue;
            };
            let head = format!(
                "HTTP/1.1 {} Mock\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
                response.status
            );
            if socket.write_all(head.as_bytes()).await.is_err() {
                continue;
            }
            for chunk in chunks {
                if socket.write_all(&chunk).await.is_err() {
                    break;
                }
                let _ = socket.flush().await;
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            tokio::time::sleep(response.hold_open).await;
            let _ = socket.shutdown().await;
        }
    });
    (base, requests)
}

/// A URL on which nothing is listening.
pub async fn closed_port_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    format!("http://{addr}")
}
