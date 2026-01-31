use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use reqwest::Client;
use std::time::Duration;

pub struct WebFetchTool;

impl WebFetchTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for WebFetchTool {
    fn name(&self) -> &'static str {
        "webfetch"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "webfetch",
            "description": "Fetch web content from a URL and convert HTML to readable Markdown text. Useful for reading documentation, researching online resources, or gathering information from web pages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "URL to fetch (e.g., https://example.com/docs)"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (default: 10, max: 60)",
                        "default": 10
                    },
                    "max_length": {
                        "type": "integer",
                        "description": "Maximum characters to return (default: 50000, max: 100000)",
                        "default": 50000
                    }
                },
                "required": ["url"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let url = input.get("url")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'url' parameter")?;

        // Validate URL
        let parsed_url = reqwest::Url::parse(url)
            .map_err(|e| format!("Invalid URL '{}': {}", url, e))?;

        // Only allow http and https schemes
        if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
            return Err(format!("Unsupported URL scheme '{}'. Only HTTP and HTTPS are allowed.", parsed_url.scheme()));
        }

        let timeout_secs = input.get("timeout")
            .and_then(|v| v.as_u64())
            .map(|v| v.min(60) as u64) // Cap at 60 seconds
            .unwrap_or(10);

        let max_length = input.get("max_length")
            .and_then(|v| v.as_u64())
            .map(|v| v.min(100000) as usize) // Cap at 100k characters
            .unwrap_or(50000);

        // Create HTTP client with timeout
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .user_agent("Anvil-Agent/1.0 (Web Fetch Tool)")
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        // Fetch the URL
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    format!("Request timed out after {} seconds", timeout_secs)
                } else if e.is_connect() {
                    format!("Connection failed: {}", e)
                } else {
                    format!("Request failed: {}", e)
                }
            })?;

        // Check status code
        let status = response.status();
        if !status.is_success() {
            return Err(format!("HTTP error {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("Unknown")));
        }

        // Get content type
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("text/html")
            .to_lowercase();

        // Get the response body
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {}", e))?;

        // Store body length before potentially moving body
        let body_len = body.len();
        let was_truncated = body_len > max_length;

        // Convert to readable text based on content type
        let content = if content_type.contains("text/html") || content_type.contains("application/xhtml") {
            // Convert HTML to Markdown/text
            html2text::from_read(body.as_bytes(), max_length.min(body_len))
        } else if content_type.contains("text/plain") || content_type.contains("text/markdown") {
            // Already text, just truncate if needed
            if was_truncated {
                format!("{}\n\n[Content truncated - exceeded max_length of {} characters]", &body[..max_length], max_length)
            } else {
                body
            }
        } else {
            // Other content types - return metadata and truncated content
            format!(
                "Content-Type: {}\n\nContent preview (first {} chars):\n{}",
                content_type,
                max_length,
                &body[..body_len.min(max_length)]
            )
        };

        Ok(json!({
            "url": url,
            "content": content,
            "content_type": content_type,
            "length": content.len(),
            "truncated": was_truncated
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_webfetch_basic() {
        let tool = WebFetchTool::new();
        let input = json!({
            "url": "https://example.com"
        });

        // This test may fail if there's no internet connection
        // In a real test environment, you'd use a mock server
        let result = tool.execute(input).await;
        
        // We expect either success or a network error
        match result {
            Ok(response) => {
                assert!(response.get("content").is_some());
                assert!(response.get("url").is_some());
            }
            Err(e) => {
                // Network errors are acceptable in tests
                assert!(
                    e.contains("timed out") || 
                    e.contains("Connection") || 
                    e.contains("Request failed") ||
                    e.contains("HTTP error"),
                    "Unexpected error: {}", e
                );
            }
        }
    }

    #[tokio::test]
    async fn test_webfetch_invalid_url() {
        let tool = WebFetchTool::new();
        let input = json!({
            "url": "not-a-valid-url"
        });

        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid URL"));
    }

    #[tokio::test]
    async fn test_webfetch_unsupported_scheme() {
        let tool = WebFetchTool::new();
        let input = json!({
            "url": "ftp://example.com/file.txt"
        });

        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported URL scheme"));
    }

    #[tokio::test]
    async fn test_webfetch_missing_url() {
        let tool = WebFetchTool::new();
        let input = json!({});

        let result = tool.execute(input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Missing 'url' parameter"));
    }
}
