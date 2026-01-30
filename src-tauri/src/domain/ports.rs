use crate::domain::models::*;
use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc::Sender;

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &'static str;
    fn schema(&self) -> Value;
    async fn execute(&self, input: Value) -> ToolResult;
}

#[async_trait]
pub trait ModelAdapter: Send + Sync {
    async fn chat(&self, req: ChatRequest) -> ChatResponse;
    async fn stream(&self, req: ChatRequest, tx: Sender<String>) -> ChatResponse;
}
