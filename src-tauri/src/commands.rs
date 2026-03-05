use crate::app_state::AppState;
use crate::adapters::openai::OpenAIAdapter;
use crate::adapters::gemini::GeminiAdapter;
use crate::adapters::anthropic::AnthropicAdapter;
use crate::adapters::ollama::OllamaAdapter;
use crate::adapters::openai_compatible::{OpenAICompatibleAdapter, known_provider_base_url};
use crate::adapters::tools::{files::ReadFileTool, files::WriteFileTool, files::EditFileTool, bash::BashTool, git::GitTool, search::SearchTool, symbols::SymbolsTool, glob::GlobTool, list::ListTool, web::WebFetchTool, patch::PatchTool, question::QuestionTool, todo::TodoWriteTool, todoread::TodoReadTool, skill::SkillTool, lsp::LspTool, mcp_tool::load_mcp_tools};
use crate::domain::agent::Agent;
use crate::domain::orchestrator::{ExecutionMode, GroupExecutionMode, Orchestrator, Task, TaskStatus};
use crate::domain::models::{AgentSession, AgentPermissions, ModelId, AgentMode, AgentRole};
use crate::config::manager::PermissionConfig;
use crate::workflows::Workflow;
use crate::storage::SessionExport;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, Emitter};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fmt::Write;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};
use url::Url;

#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Failed to resolve home directory".to_string())
}

#[tauri::command]
pub fn get_config_dir() -> Result<String, String> {
    dirs::config_dir()
        .map(|p| p.join("anvil"))
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Failed to resolve config directory".to_string())
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_workspace_file(
    workspace_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let path = PathBuf::from(workspace_path).join(relative_path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_global_file(
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let base = dirs::config_dir()
        .map(|path| path.join("anvil"))
        .ok_or_else(|| "Failed to resolve config directory".to_string())?;
    let path = base.join(relative_path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthPkceConfig {
    pub client_id: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub redirect_uri: String,
    pub scope: Option<String>,
    pub audience: Option<String>,
    pub extra_params: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthPkceStartResponse {
    pub request_id: String,
    pub authorization_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthDeviceConfig {
    pub client_id: String,
    pub device_authorization_endpoint: String,
    pub token_endpoint: String,
    pub scope: Option<String>,
    pub audience: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OAuthDeviceResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(default)]
    pub verification_uri_complete: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub interval: Option<u64>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OAuthTokenResponse {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub id_token: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
    pub error_uri: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthProviderConfigEntry {
    client_id: String,
    token_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenEntry {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub expires_at: Option<u64>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenStatus {
    pub connected: bool,
    pub expires_at: Option<u64>,
    pub has_refresh: bool,
}

const KEYCHAIN_SERVICE: &str = "anvil";
const KEYCHAIN_KEY: &str = "oauth_tokens";
const API_KEY_SERVICE: &str = "anvil_api_keys";
const API_KEY_INDEX_ENTRY: &str = "_providers_index";

fn config_dir() -> Result<std::path::PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("anvil"))
        .ok_or_else(|| "Failed to resolve config directory".to_string())
}

// ─── API Key Keychain Helpers ─────────────────────────────────────────────────

fn load_api_key_index() -> Vec<String> {
    // Try keychain first
    if let Ok(entry) = keyring::Entry::new(API_KEY_SERVICE, API_KEY_INDEX_ENTRY) {
        if let Ok(json) = entry.get_password() {
            if let Ok(providers) = serde_json::from_str::<Vec<String>>(&json) {
                return providers;
            }
        }
    }
    // Fallback: config dir file
    if let Ok(dir) = config_dir() {
        let path = dir.join("api_key_providers.json");
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(providers) = serde_json::from_str::<Vec<String>>(&content) {
                return providers;
            }
        }
    }
    Vec::new()
}

fn save_api_key_index(providers: &[String]) -> Result<(), String> {
    let json = serde_json::to_string(providers).map_err(|e| e.to_string())?;
    if let Ok(entry) = keyring::Entry::new(API_KEY_SERVICE, API_KEY_INDEX_ENTRY) {
        if entry.set_password(&json).is_ok() {
            return Ok(());
        }
    }
    // Fallback: config dir file
    let dir = config_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(dir.join("api_key_providers.json"), json).map_err(|e| e.to_string())
}

// ─── Provider Adapter Builder ─────────────────────────────────────────────────

fn build_model_adapter(
    provider: &str,
    api_key: &str,
    model_id: &str,
    base_url: Option<&str>,
) -> Result<Arc<dyn crate::domain::ports::ModelAdapter>, String> {
    match provider {
        "openai" => Ok(Arc::new(OpenAIAdapter::new(api_key.to_string()))),
        "gemini" => Ok(Arc::new(GeminiAdapter::new(api_key.to_string(), model_id.to_string()))),
        "anthropic" => Ok(Arc::new(AnthropicAdapter::new(api_key.to_string(), model_id.to_string()))),
        "ollama" => Ok(Arc::new(OllamaAdapter::new(None))),
        p => {
            // Try known OpenAI-compatible providers, then fall back to custom base_url
            let url = known_provider_base_url(p)
                .map(|s| s.to_string())
                .or_else(|| base_url.map(|s| s.to_string()));
            if let Some(url) = url {
                Ok(Arc::new(OpenAICompatibleAdapter::new(
                    api_key.to_string(),
                    url,
                    model_id.to_string(),
                )))
            } else {
                Err(format!("Unsupported provider: {}", p))
            }
        }
    }
}

fn read_oauth_config() -> Result<HashMap<String, OAuthProviderConfigEntry>, String> {
    let path = config_dir()?.join("oauth.json");
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let providers = parsed
        .get("providers")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "oauth.json missing providers".to_string())?;

    let mut config = HashMap::new();
    for (provider_id, value) in providers {
        let client_id = value
            .get("clientId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("oauth.json missing clientId for {}", provider_id))?;
        let token_endpoint = value
            .get("tokenEndpoint")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("oauth.json missing tokenEndpoint for {}", provider_id))?;
        config.insert(
            provider_id.to_string(),
            OAuthProviderConfigEntry {
                client_id: client_id.to_string(),
                token_endpoint: token_endpoint.to_string(),
            },
        );
    }

    Ok(config)
}

fn load_oauth_tokens_from_keychain() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY)
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(_) => Ok(None),
    }
}

fn save_oauth_tokens_to_keychain(payload: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY)
        .map_err(|e| e.to_string())?;
    entry.set_password(payload).map_err(|e| e.to_string())
}

fn parse_token_entry(value: &serde_json::Value) -> Result<OAuthTokenEntry, String> {
    let access_token = value
        .get("accessToken")
        .or_else(|| value.get("access_token"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing access token".to_string())?
        .to_string();
    let refresh_token = value
        .get("refreshToken")
        .or_else(|| value.get("refresh_token"))
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());
    let expires_in = value
        .get("expiresIn")
        .or_else(|| value.get("expires_in"))
        .and_then(|v| v.as_u64());
    let expires_at = value
        .get("expiresAt")
        .or_else(|| value.get("expires_at"))
        .and_then(|v| v.as_u64());
    let token_type = value
        .get("tokenType")
        .or_else(|| value.get("token_type"))
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());
    let scope = value
        .get("scope")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    Ok(OAuthTokenEntry {
        access_token,
        refresh_token,
        expires_in,
        expires_at,
        token_type,
        scope,
    })
}

fn parse_oauth_tokens_payload(payload: &str) -> Result<HashMap<String, OAuthTokenEntry>, String> {
    if let Ok(tokens) = serde_json::from_str::<HashMap<String, OAuthTokenEntry>>(payload) {
        return Ok(tokens);
    }

    let raw: serde_json::Value = serde_json::from_str(payload).map_err(|e| e.to_string())?;
    let map = raw.as_object().ok_or_else(|| "OAuth tokens payload invalid".to_string())?;
    let mut tokens = HashMap::new();
    for (provider_id, value) in map {
        let entry = parse_token_entry(value).map_err(|e| format!("{}: {}", provider_id, e))?;
        tokens.insert(provider_id.to_string(), entry);
    }
    Ok(tokens)
}

fn load_oauth_tokens_from_file() -> Result<HashMap<String, OAuthTokenEntry>, String> {
    let path = config_dir()?.join("oauth_tokens.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => parse_oauth_tokens_payload(&content),
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                Ok(HashMap::new())
            } else {
                Err(err.to_string())
            }
        }
    }
}

fn save_oauth_tokens_to_file(tokens: &HashMap<String, OAuthTokenEntry>) -> Result<(), String> {
    let base = config_dir()?;
    if !base.exists() {
        std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    }
    let path = base.join("oauth_tokens.json");
    let payload = serde_json::to_string_pretty(tokens).map_err(|e| e.to_string())?;
    std::fs::write(&path, payload).map_err(|e| e.to_string())
}

fn load_oauth_tokens() -> Result<HashMap<String, OAuthTokenEntry>, String> {
    if let Some(payload) = load_oauth_tokens_from_keychain()? {
        if let Ok(tokens) = parse_oauth_tokens_payload(&payload) {
            return Ok(tokens);
        }
    }
    load_oauth_tokens_from_file()
}

fn save_oauth_tokens(tokens: &HashMap<String, OAuthTokenEntry>) -> Result<(), String> {
    let payload = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    if save_oauth_tokens_to_keychain(&payload).is_ok() {
        return Ok(());
    }
    save_oauth_tokens_to_file(tokens)
}

fn now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn code_challenge_from_verifier(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let result = hasher.finalize();
    URL_SAFE_NO_PAD.encode(result)
}

fn build_auth_url(config: &OAuthPkceConfig, code_challenge: &str, state: &str) -> Result<String, String> {
    let mut url = Url::parse(&config.authorization_endpoint).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("response_type", "code");
        pairs.append_pair("client_id", &config.client_id);
        pairs.append_pair("redirect_uri", &config.redirect_uri);
        pairs.append_pair("code_challenge", code_challenge);
        pairs.append_pair("code_challenge_method", "S256");
        pairs.append_pair("state", state);
        if let Some(scope) = config.scope.as_ref().filter(|value| !value.trim().is_empty()) {
            pairs.append_pair("scope", scope);
        }
        if let Some(audience) = config.audience.as_ref().filter(|value| !value.trim().is_empty()) {
            pairs.append_pair("audience", audience);
        }
        if let Some(extra) = config.extra_params.as_ref() {
            for (key, value) in extra {
                if !key.trim().is_empty() {
                    pairs.append_pair(key, value);
                }
            }
        }
    }
    Ok(url.to_string())
}

async fn listen_for_oauth_code(
    redirect_uri: &str,
    expected_state: &str,
) -> Result<String, String> {
    let url = Url::parse(redirect_uri).map_err(|e| e.to_string())?;
    let host = url.host_str().ok_or("Redirect URI missing host")?;
    let port = url.port().ok_or("Redirect URI missing port")?;
    let path = url.path();

    let listener = TcpListener::bind((host, port))
        .await
        .map_err(|e| e.to_string())?;

    let accept = timeout(Duration::from_secs(600), listener.accept())
        .await
        .map_err(|_| "OAuth timed out waiting for callback".to_string())?;
    let (mut socket, _) = accept.map_err(|e| e.to_string())?;

    let mut buffer = vec![0u8; 4096];
    let n = socket.read(&mut buffer).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..n]);
    let first_line = request.lines().next().unwrap_or("");
    let request_path = first_line.split_whitespace().nth(1).unwrap_or("/");

    let request_url = Url::parse(&format!("http://{}:{}{}", host, port, request_path))
        .map_err(|e| e.to_string())?;
    let mut code = None;
    let mut state = None;
    for (key, value) in request_url.query_pairs() {
        if key == "code" {
            code = Some(value.to_string());
        }
        if key == "state" {
            state = Some(value.to_string());
        }
    }

    let response_body = "<html><body><h2>Authorization complete</h2><p>You can close this window.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
        response_body.len(),
        response_body
    );
    let _ = socket.write_all(response.as_bytes()).await;

    let code = code.ok_or("Missing authorization code")?;
    let state = state.ok_or("Missing OAuth state")?;
    if state != expected_state {
        return Err("OAuth state mismatch".to_string());
    }

    if path != request_url.path() {
        return Err("OAuth callback path mismatch".to_string());
    }

    Ok(code)
}

#[tauri::command]
pub async fn oauth_pkce_start(
    state: State<'_, AppState>,
    config: OAuthPkceConfig,
) -> Result<OAuthPkceStartResponse, String> {
    let verifier = generate_code_verifier();
    let challenge = code_challenge_from_verifier(&verifier);
    let request_id = Uuid::new_v4().to_string();
    let state_token = Uuid::new_v4().to_string();
    let auth_url = build_auth_url(&config, &challenge, &state_token)?;
    let pending_oauth = state.pending_oauth.clone();
    let config_clone = config.clone();
    let verifier_clone = verifier.clone();
    let request_id_clone = request_id.clone();

    tokio::spawn(async move {
        let result = async {
            let code = listen_for_oauth_code(&config_clone.redirect_uri, &state_token).await?;
            let client = reqwest::Client::new();
            let mut form = vec![
                ("grant_type", "authorization_code".to_string()),
                ("client_id", config_clone.client_id.clone()),
                ("code", code),
                ("redirect_uri", config_clone.redirect_uri.clone()),
                ("code_verifier", verifier_clone),
            ];
            if let Some(scope) = config_clone.scope.as_ref().filter(|value| !value.trim().is_empty()) {
                form.push(("scope", scope.to_string()));
            }
            if let Some(audience) = config_clone.audience.as_ref().filter(|value| !value.trim().is_empty()) {
                form.push(("audience", audience.to_string()));
            }

            let response = client
                .post(config_clone.token_endpoint)
                .header("Accept", "application/json")
                .form(&form)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let body = response.text().await.map_err(|e| e.to_string())?;
            serde_json::from_str::<OAuthTokenResponse>(&body).map_err(|e| e.to_string())
        };

        let payload = match result.await {
            Ok(value) => serde_json::to_value(value).unwrap_or_else(|_| json!({"error": "Invalid token response"})),
            Err(error) => json!({"error": "oauth_error", "error_description": error}),
        };

        if let Ok(mut map) = pending_oauth.lock() {
            map.insert(request_id_clone, payload);
        }
    });

    Ok(OAuthPkceStartResponse {
        request_id,
        authorization_url: auth_url,
    })
}

#[tauri::command]
pub async fn oauth_pkce_poll(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<Option<OAuthTokenResponse>, String> {
    let mut map = state.pending_oauth.lock().map_err(|_| "Failed to lock OAuth state")?;
    if let Some(value) = map.remove(&request_id) {
        let response = serde_json::from_value::<OAuthTokenResponse>(value).map_err(|e| e.to_string())?;
        Ok(Some(response))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn oauth_store_tokens(
    provider_id: String,
    mut token: OAuthTokenEntry,
) -> Result<(), String> {
    if token.expires_at.is_none() {
        token.expires_at = token.expires_in.map(|ttl| now_millis() + ttl * 1000);
    }
    let mut tokens = load_oauth_tokens()?;
    tokens.insert(provider_id, token);
    save_oauth_tokens(&tokens).map_err(|e| format!("Failed to save oauth tokens: {}", e))
}

#[tauri::command]
pub async fn oauth_clear_tokens(provider_id: String) -> Result<(), String> {
    let mut tokens = load_oauth_tokens()?;
    tokens.remove(&provider_id);
    save_oauth_tokens(&tokens)
}

#[tauri::command]
pub async fn oauth_token_status() -> Result<HashMap<String, OAuthTokenStatus>, String> {
    let tokens = load_oauth_tokens()?;
    let mut status = HashMap::new();
    for (provider_id, token) in tokens {
        status.insert(
            provider_id,
            OAuthTokenStatus {
                connected: !token.access_token.is_empty(),
                expires_at: token.expires_at,
                has_refresh: token.refresh_token.as_ref().map(|v| !v.is_empty()).unwrap_or(false),
            },
        );
    }
    Ok(status)
}

#[tauri::command]
pub async fn oauth_get_access_token(provider_id: String) -> Result<String, String> {
    let mut tokens = load_oauth_tokens()?;
    let token = tokens
        .get(&provider_id)
        .cloned()
        .ok_or_else(|| "OAuth token not found".to_string())?;

    let access_token = token.access_token.clone();
    if access_token.is_empty() {
        return Err("OAuth access token missing".to_string());
    }

    if let Some(expires_at) = token.expires_at {
        let now = now_millis();
        if now + 300_000 < expires_at {
            return Ok(access_token);
        }
    } else if token.refresh_token.is_none() {
        return Ok(access_token);
    }

    let refresh_token = token
        .refresh_token
        .clone()
        .ok_or_else(|| "OAuth refresh token missing".to_string())?;
    if refresh_token.is_empty() {
        return Err("OAuth refresh token missing".to_string());
    }

    let config = read_oauth_config()?;
    let provider_config = config
        .get(&provider_id)
        .ok_or_else(|| "OAuth config missing for provider".to_string())?;

    let client = reqwest::Client::new();
    let response = client
        .post(&provider_config.token_endpoint)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", provider_config.client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = response.text().await.map_err(|e| e.to_string())?;
    let refresh_response: OAuthTokenResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    if let Some(error) = refresh_response.error.clone() {
        let description = refresh_response.error_description.unwrap_or(error);
        return Err(description);
    }

    let new_access = refresh_response
        .access_token
        .clone()
        .ok_or_else(|| "OAuth refresh response missing access token".to_string())?;
    let new_refresh = refresh_response.refresh_token.clone().or(token.refresh_token.clone());
    let now = now_millis();
    let expires_at = refresh_response.expires_in.map(|ttl| now + ttl * 1000);

    let updated = OAuthTokenEntry {
        access_token: new_access.clone(),
        refresh_token: new_refresh,
        expires_in: refresh_response.expires_in,
        expires_at,
        token_type: refresh_response.token_type,
        scope: refresh_response.scope,
    };
    tokens.insert(provider_id, updated);
    save_oauth_tokens(&tokens)?;

    Ok(new_access)
}

// ─── API Key Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn store_api_key(provider: String, api_key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(API_KEY_SERVICE, &provider).map_err(|e| e.to_string())?;
    entry.set_password(&api_key).map_err(|e| e.to_string())?;
    let mut providers = load_api_key_index();
    if !providers.contains(&provider) {
        providers.push(provider);
        save_api_key_index(&providers)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_api_key(provider: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(API_KEY_SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) if !key.is_empty() => Ok(Some(key)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn delete_api_key(provider: String) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(API_KEY_SERVICE, &provider) {
        let _ = entry.delete_password();
    }
    let mut providers = load_api_key_index();
    providers.retain(|p| p != &provider);
    save_api_key_index(&providers)
}

#[tauri::command]
pub async fn list_stored_providers() -> Result<Vec<String>, String> {
    Ok(load_api_key_index())
}

// ─── SQLite Settings / Models Commands ───────────────────────────────────────

#[tauri::command]
pub async fn get_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    state.with_storage(|storage| storage.get_setting(&key))
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.with_storage(|storage| storage.set_setting(&key, &value))
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
    provider: Option<String>,
) -> Result<Vec<crate::storage::StoredModel>, String> {
    state.with_storage(|storage| storage.list_models(provider.as_deref()))
}

#[tauri::command]
pub async fn upsert_model(
    state: State<'_, AppState>,
    model: crate::storage::StoredModel,
) -> Result<(), String> {
    state.with_storage(|storage| storage.upsert_model(&model))
}

#[tauri::command]
pub async fn delete_model(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.with_storage(|storage| storage.delete_model(&id))
}

#[tauri::command]
pub async fn list_openai_models(
    api_key: Option<String>,
    oauth_provider: Option<String>,
) -> Result<Vec<String>, String> {
    if oauth_provider.is_some() {
        return Ok(vec![
            "gpt-5.2".to_string(),
            "gpt-5.2-codex".to_string(),
            "gpt-5.1".to_string(),
            "gpt-5.1-codex".to_string(),
            "gpt-5.1-codex-max".to_string(),
            "gpt-5.1-codex-mini".to_string(),
            "codex-mini-latest".to_string(),
        ]);
    }

    let token = api_key.ok_or_else(|| "OpenAI API key required".to_string())?;

    let client = reqwest::Client::new();
    let response = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = response.text().await.map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let data = parsed
        .get("data")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "OpenAI models response missing data".to_string())?;

    let mut models = Vec::new();
    for entry in data {
        if let Some(id) = entry.get("id").and_then(|value| value.as_str()) {
            models.push(id.to_string());
        }
    }

    if models.is_empty() {
        return Err("OpenAI models list is empty".to_string());
    }

    models.sort();
    models.dedup();
    Ok(models)
}

#[tauri::command]
pub async fn list_ollama_models(base_url: String) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    let url = if base.ends_with("/api") {
        format!("{}/tags", base)
    } else {
        format!("{}/api/tags", base)
    };
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = response.text().await.map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let data = parsed
        .get("models")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Ollama response missing models".to_string())?;

    let mut models = Vec::new();
    for entry in data {
        if let Some(id) = entry.get("name").and_then(|value| value.as_str()) {
            models.push(id.to_string());
        }
    }

    if models.is_empty() {
        return Err("Ollama models list is empty".to_string());
    }

    models.sort();
    models.dedup();
    Ok(models)
}

#[tauri::command]
pub async fn oauth_device_start(config: OAuthDeviceConfig) -> Result<OAuthDeviceResponse, String> {
    let client = reqwest::Client::new();
    let mut form: Vec<(String, String)> = vec![("client_id".to_string(), config.client_id)];

    if let Some(scope) = config.scope.as_ref().filter(|value| !value.trim().is_empty()) {
        form.push(("scope".to_string(), scope.to_string()));
    }

    if let Some(audience) = config.audience.as_ref().filter(|value| !value.trim().is_empty()) {
        form.push(("audience".to_string(), audience.to_string()));
    }

    let response = client
        .post(config.device_authorization_endpoint)
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<OAuthDeviceResponse>(&body)
        .map_err(|e| format!("Device authorization failed ({}): {}", status, e))
}

#[tauri::command]
pub async fn oauth_device_poll(
    config: OAuthDeviceConfig,
    device_code: String,
) -> Result<OAuthTokenResponse, String> {
    let client = reqwest::Client::new();
    let form = vec![
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code".to_string()),
        ("device_code", device_code),
        ("client_id", config.client_id),
    ];

    let response = client
        .post(config.token_endpoint)
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<OAuthTokenResponse>(&body)
        .map_err(|e| format!("Token polling failed ({}): {}", status, e))
}

#[tauri::command]
pub async fn open_file_in_editor(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let content = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;

    let reason = format!("Agent opened file.");
    let line_start = 1; // Placeholder for now
    let line_end = 1;

    // Emit event to frontend so Editor can follow/open tab
    let _ = app.emit("file-opened-by-agent", json!({
        "path": path,
        "reason": reason,
        "line_start": line_start,
        "line_end": line_end
    }));

    Ok(content)
}

 

#[tauri::command]
pub async fn spawn_terminal(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    workspace_path: Option<String>,
) -> Result<(), String> {
    let mut terminal = state.terminal.lock().map_err(|_| "Failed to lock terminal")?;
    let workspace_root = workspace_path.map(PathBuf::from);
    terminal.spawn(app, workspace_root)
}

#[tauri::command]
pub fn write_terminal(
    state: State<'_, AppState>,
    data: String,
) -> Result<(), String> {
    let terminal = state.terminal.lock().map_err(|_| "Failed to lock terminal")?;
    terminal.write(data)
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminal = state.terminal.lock().map_err(|_| "Failed to lock terminal")?;
    terminal.resize(cols, rows)
}

#[tauri::command]
pub async fn create_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_path: String,
    api_key: String,
    provider: String,
    model_id: String,
    base_url: Option<String>,
) -> Result<String, String> {
    let id = Uuid::new_v4();
    let path = PathBuf::from(&workspace_path);

    if !path.exists() {
        return Err("Workspace path does not exist".to_string());
    }

    let model = build_model_adapter(&provider, &api_key, &model_id, base_url.as_deref())?;

    let mut config_manager = crate::config::ConfigManager::new();
    let _ = config_manager.load(Some(&path));
    let config = config_manager.config();
    let permission_manager = Arc::new(tokio::sync::Mutex::new(config.permission.clone()));

    let mut tools: Vec<Arc<dyn crate::domain::ports::Tool>> = vec![
        Arc::new(ReadFileTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(WriteFileTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(LspTool::new(
            path.clone(),
            permission_manager.clone(),
            config.lsp.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(EditFileTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone(), permission_manager.clone())),
        Arc::new(ListTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
        Arc::new(TodoReadTool::new(path.clone())),
        Arc::new(SkillTool::new(
            path.clone(),
            id.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
    ];

    // Load MCP tools from configuration
    match load_mcp_tools(&path).await {
        Ok(mcp_tools) => {
            tools.extend(mcp_tools);
        }
        Err(e) => {
            println!("⚠️  Warning: Failed to load MCP tools: {}", e);
        }
    }

    let new_session = AgentSession {
        id,
        workspace_path: path.clone(),
        model: ModelId(model_id.clone()),
        mode: AgentMode::Build,
        messages: vec![],
        permissions: AgentPermissions { 
            config: config.permission.clone() 
        },
    };

    let agent = Agent::new(
        new_session.clone(),
        model.clone(),
        tools,
        permission_manager,
        Some(app.clone()),
        Some(state.pending_confirmations.clone()),
    );

    let mut agents = state.agents.lock().await;
    agents.insert(id, Arc::new(Mutex::new(agent)));

    crate::config::start_config_watcher(
        state.agents.clone(),
        state.config_watchers.clone(),
        path.clone(),
    );

    Ok(id.to_string())
}

#[tauri::command]
pub async fn chat(
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    model_id: Option<String>,
    api_key: Option<String>,
    mode: Option<String>,
    attachments: Option<Vec<crate::domain::models::Attachment>>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&session_id).map_err(|_| "Invalid UUID")?;

    let agent_arc = {
        let agents = state.agents.lock().await;
        agents.get(&uuid).cloned().ok_or("Session not found".to_string())?
    };

    let mut agent = agent_arc.lock().await;

    if let Some(m) = mode {
        let new_mode = match m.to_lowercase().as_str() {
            "plan" => AgentMode::Plan,
            "research" => AgentMode::Research,
            _ => AgentMode::Build,
        };
        agent.update_mode(new_mode);
    }

    if let (Some(m_id), Some(key)) = (model_id, api_key) {
        let inferred_provider = if m_id.starts_with("gemini") { "gemini" }
            else if m_id.starts_with("claude") { "anthropic" }
            else { "openai" };
        if let Ok(adapter) = build_model_adapter(inferred_provider, &key, &m_id, None) {
            agent.update_model(adapter, ModelId(m_id));
        }
    }

    agent.step(Some(message), attachments).await
}

#[tauri::command]
pub async fn stream_chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    message: String,
    model_id: Option<String>,
    api_key: Option<String>,
    mode: Option<String>,
    attachments: Option<Vec<crate::domain::models::Attachment>>,
) -> Result<String, String> {
    let uuid = Uuid::parse_str(&session_id).map_err(|_| "Invalid UUID")?;

    let agent_arc = {
        let agents = state.agents.lock().await;
        agents.get(&uuid).cloned().ok_or("Session not found".to_string())?
    };

    let mut agent = agent_arc.lock().await;

    if let Some(m) = mode {
        let new_mode = match m.to_lowercase().as_str() {
            "plan" => AgentMode::Plan,
            "research" => AgentMode::Research,
            _ => AgentMode::Build,
        };
        agent.update_mode(new_mode);
    }

    if let (Some(m_id), Some(key)) = (model_id, api_key) {
        let inferred_provider = if m_id.starts_with("gemini") { "gemini" }
            else if m_id.starts_with("claude") { "anthropic" }
            else { "openai" };
        if let Ok(adapter) = build_model_adapter(inferred_provider, &key, &m_id, None) {
            agent.update_model(adapter, ModelId(m_id));
        }
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut cancels = state.stream_cancels.lock().map_err(|_| "Failed to lock cancels")?;
        cancels.insert(session_id.clone(), cancel_flag.clone());
    }

    let app_handle = app.clone();
    let session_id_for_emit = session_id.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = app_handle.emit("chat-token", json!({
                "session_id": session_id_for_emit,
                "token": chunk
            }));
        }
    });

    let result = agent.step_stream(Some(message), attachments, tx, Some(cancel_flag)).await;

    if let Ok(mut cancels) = state.stream_cancels.lock() {
        cancels.remove(&session_id);
    }

    result
}

#[tauri::command]
pub async fn stop_stream(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    if let Ok(cancels) = state.stream_cancels.lock() {
        if let Some(flag) = cancels.get(&session_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn confirm_action(
    state: State<'_, AppState>,
    id: String,
    session_id: String,
    allowed: bool,
    always: bool,
    pattern: Option<String>,
) -> Result<(), String> {
    println!("Confirming action: id={}, session={}, allowed={}, always={}, pattern={:?}", id, session_id, allowed, always, pattern);
    let mut map = state.pending_confirmations.lock().map_err(|_| "Failed to lock")?;
    if let Some(tx) = map.remove(&id) {
        let _ = tx.send(crate::domain::models::ConfirmationResponse {
            allowed,
            always,
            pattern,
        });
        Ok(())
    } else {
        Err("Confirmation ID not found or already processed".to_string())
    }
}

#[tauri::command]
pub async fn save_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&session_id).map_err(|_| "Invalid UUID")?;

    let agent_arc = {
        let agents = state.agents.lock().await;
        agents.get(&uuid).cloned().ok_or("Session not found".to_string())?
    };

    let agent = agent_arc.lock().await;
    let session = agent.get_session();

    state.with_storage(|storage| storage.save_session(&session))
}

#[tauri::command]
pub async fn load_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<AgentSession, String> {
    state.with_storage(|storage| storage.load_session(&session_id))
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::SessionMetadata>, String> {
    state.with_storage(|storage| storage.list_sessions())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRedactions {
    pub workspace_path: Option<bool>,
    pub attachments: Option<bool>,
    pub tool_arguments: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionShareInfo {
    pub share_id: String,
    pub url: String,
    pub expires_at: u64,
    pub one_time: bool,
    pub format: String,
}

fn sanitize_export_basename(value: &str) -> String {
    let mut name: String = value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    while name.contains("__") {
        name = name.replace("__", "_");
    }
    name.trim_matches('_').to_string()
}

fn build_export_basename(export: &SessionExport) -> String {
    if let Some(name) = export.name.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        let sanitized = sanitize_export_basename(name);
        if !sanitized.is_empty() {
            return sanitized;
        }
    }
    let suffix = export.id.chars().take(8).collect::<String>();
    format!("session-{}", suffix)
}

fn summarize_attachments(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name").and_then(|v| v.as_str());
                    let mime = item.get("mime_type").and_then(|v| v.as_str());
                    match (name, mime) {
                        (Some(name), Some(mime)) => Some(format!("{} ({})", name, mime)),
                        (Some(name), None) => Some(name.to_string()),
                        _ => None,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn render_export_markdown(export: &SessionExport) -> Result<String, String> {
    let mut output = String::new();
    writeln!(output, "# Session Export").map_err(|e| e.to_string())?;
    if let Some(name) = export.name.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        writeln!(output, "- Name: {}", name).map_err(|e| e.to_string())?;
    }
    writeln!(output, "- Id: {}", export.id).map_err(|e| e.to_string())?;
    writeln!(output, "- Workspace: {}", export.workspace_path).map_err(|e| e.to_string())?;
    writeln!(output, "- Model: {}", export.model).map_err(|e| e.to_string())?;
    writeln!(output, "- Mode: {}", export.mode).map_err(|e| e.to_string())?;
    writeln!(output, "- Created: {}", export.created_at).map_err(|e| e.to_string())?;
    writeln!(output, "").map_err(|e| e.to_string())?;
    writeln!(output, "## Messages").map_err(|e| e.to_string())?;

    for message in &export.messages {
        writeln!(output, "").map_err(|e| e.to_string())?;
        writeln!(output, "### {} · {}", message.role, message.timestamp).map_err(|e| e.to_string())?;

        if let Some(tool_call_id) = message.tool_call_id.as_ref().filter(|value| !value.is_empty()) {
            writeln!(output, "- Tool call id: {}", tool_call_id).map_err(|e| e.to_string())?;
        }

        if let Some(attachments) = message.attachments.as_ref() {
            let attachment_list = summarize_attachments(attachments);
            if !attachment_list.is_empty() {
                writeln!(output, "- Attachments: {}", attachment_list.join(", "))
                    .map_err(|e| e.to_string())?;
            }
        }

        writeln!(output, "").map_err(|e| e.to_string())?;
        if let Some(content) = message.content.as_ref().filter(|value| !value.is_empty()) {
            writeln!(output, "{}", content).map_err(|e| e.to_string())?;
        } else {
            writeln!(output, "_No content_").map_err(|e| e.to_string())?;
        }

        if let Some(tool_calls) = message.tool_calls.as_ref() {
            let tool_json = serde_json::to_string_pretty(tool_calls).map_err(|e| e.to_string())?;
            writeln!(output, "\nTool calls:\n```json\n{}\n```", tool_json)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(output)
}

fn apply_export_redactions(mut export: SessionExport, redactions: &ExportRedactions) -> SessionExport {
    if redactions.workspace_path.unwrap_or(false) {
        export.workspace_path = "<redacted>".to_string();
    }

    for message in &mut export.messages {
        if redactions.tool_arguments.unwrap_or(false) {
            if let Some(tool_calls) = message.tool_calls.as_mut() {
                if let Some(calls) = tool_calls.as_array_mut() {
                    for call in calls.iter_mut() {
                        if let Some(obj) = call.as_object_mut() {
                            if obj.contains_key("arguments") {
                                obj.insert("arguments".to_string(), Value::String("<redacted>".to_string()));
                            }
                        }
                    }
                }
            }
        }

        if redactions.attachments.unwrap_or(false) {
            if let Some(attachments) = message.attachments.as_mut() {
                if let Some(items) = attachments.as_array_mut() {
                    for attachment in items.iter_mut() {
                        if let Some(obj) = attachment.as_object_mut() {
                            obj.remove("data");
                        }
                    }
                }
            }
        }
    }

    export
}

fn resolve_local_share_host(allow_lan: bool) -> String {
    if !allow_lan {
        return "127.0.0.1".to_string();
    }

    let socket = match std::net::UdpSocket::bind("0.0.0.0:0") {
        Ok(socket) => socket,
        Err(_) => return "127.0.0.1".to_string(),
    };

    if socket.connect("8.8.8.8:80").is_err() {
        return "127.0.0.1".to_string();
    }

    match socket.local_addr() {
        Ok(addr) => addr.ip().to_string(),
        Err(_) => "127.0.0.1".to_string(),
    }
}

async fn run_local_share_server(
    share_id: String,
    listener: TcpListener,
    token: String,
    content: String,
    content_type: String,
    download_name: String,
    expires_at: u64,
    cancel_flag: Arc<AtomicBool>,
    shares: Arc<std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>>,
) {
    let route = format!("/share/{}", token);
    let mut served = false;

    loop {
        if cancel_flag.load(Ordering::SeqCst) || served || now_millis() >= expires_at {
            break;
        }

        let accepted = timeout(Duration::from_millis(500), listener.accept()).await;
        let Ok(Ok((mut socket, _))) = accepted else {
            continue;
        };

        let mut buffer = vec![0u8; 8192];
        let read_result = timeout(Duration::from_secs(5), socket.read(&mut buffer)).await;
        let Ok(Ok(bytes_read)) = read_result else {
            continue;
        };
        if bytes_read == 0 {
            continue;
        }

        let request = String::from_utf8_lossy(&buffer[..bytes_read]);
        let first_line = request.lines().next().unwrap_or_default();
        let request_path = first_line.split_whitespace().nth(1).unwrap_or("/");

        let (status_line, body, response_content_type, attachment_name, mark_served) =
            if now_millis() >= expires_at {
                (
                    "410 Gone",
                    "Share link expired".to_string(),
                    "text/plain; charset=utf-8".to_string(),
                    None,
                    false,
                )
            } else if request_path == route {
                (
                    "200 OK",
                    content.clone(),
                    content_type.clone(),
                    Some(download_name.clone()),
                    true,
                )
            } else {
                (
                    "404 Not Found",
                    "Not found".to_string(),
                    "text/plain; charset=utf-8".to_string(),
                    None,
                    false,
                )
            };

        let body_bytes = body.as_bytes();
        let mut headers = format!(
            "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n",
            status_line,
            response_content_type,
            body_bytes.len()
        );
        if let Some(name) = attachment_name {
            headers.push_str(&format!(
                "Content-Disposition: attachment; filename=\"{}\"\r\n",
                name
            ));
        }
        headers.push_str("\r\n");

        let _ = socket.write_all(headers.as_bytes()).await;
        let _ = socket.write_all(body_bytes).await;

        if mark_served {
            served = true;
        }
    }

    if let Ok(mut map) = shares.lock() {
        map.remove(&share_id);
    }
}

#[tauri::command]
pub async fn export_session(
    state: State<'_, AppState>,
    session_id: String,
    redactions: Option<ExportRedactions>,
) -> Result<serde_json::Value, String> {
    let export = state.with_storage(|storage| storage.export_session(&session_id))?;
    let export = if let Some(redactions) = redactions.as_ref() {
        apply_export_redactions(export, redactions)
    } else {
        export
    };
    let markdown = render_export_markdown(&export)?;
    let json_value = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    let basename = build_export_basename(&export);

    Ok(json!({
        "session_id": export.id,
        "basename": basename,
        "markdown": markdown,
        "json": json_value
    }))
}

#[tauri::command]
pub async fn start_local_session_share(
    state: State<'_, AppState>,
    session_id: String,
    format: Option<String>,
    redactions: Option<ExportRedactions>,
    allow_lan: Option<bool>,
    ttl_seconds: Option<u64>,
) -> Result<LocalSessionShareInfo, String> {
    let export = state.with_storage(|storage| storage.export_session(&session_id))?;

    let effective_redactions = redactions.unwrap_or(ExportRedactions {
        workspace_path: Some(true),
        attachments: Some(true),
        tool_arguments: Some(true),
    });
    let export = apply_export_redactions(export, &effective_redactions);
    let basename = build_export_basename(&export);

    let format = format
        .unwrap_or_else(|| "json".to_string())
        .trim()
        .to_lowercase();
    let (content, content_type, extension) = match format.as_str() {
        "json" => (
            serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?,
            "application/json; charset=utf-8".to_string(),
            "json".to_string(),
        ),
        "markdown" | "md" => (
            render_export_markdown(&export)?,
            "text/markdown; charset=utf-8".to_string(),
            "md".to_string(),
        ),
        _ => return Err("Unsupported share format. Use 'json' or 'markdown'.".to_string()),
    };

    let allow_lan = allow_lan.unwrap_or(false);
    let bind_addr = if allow_lan {
        "0.0.0.0:0"
    } else {
        "127.0.0.1:0"
    };
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("Failed to start local share server: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to resolve local share address: {}", e))?
        .port();

    let ttl = ttl_seconds.unwrap_or(600).clamp(60, 3600);
    let expires_at = now_millis() + (ttl * 1000);
    let share_id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().to_string().replace('-', "");
    let host = resolve_local_share_host(allow_lan);
    let url = format!("http://{}:{}/share/{}", host, port, token);
    let download_name = format!("{}.{}", basename, extension);

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut shares = state
            .local_session_shares
            .lock()
            .map_err(|_| "Failed to lock local share registry".to_string())?;
        shares.insert(share_id.clone(), cancel_flag.clone());
    }

    let share_registry = state.local_session_shares.clone();
    let task_share_id = share_id.clone();
    tokio::spawn(async move {
        run_local_share_server(
            task_share_id,
            listener,
            token,
            content,
            content_type,
            download_name,
            expires_at,
            cancel_flag,
            share_registry,
        )
        .await;
    });

    Ok(LocalSessionShareInfo {
        share_id,
        url,
        expires_at,
        one_time: true,
        format,
    })
}

#[tauri::command]
pub async fn stop_local_session_share(
    state: State<'_, AppState>,
    share_id: String,
) -> Result<(), String> {
    let cancel_flag = {
        let mut shares = state
            .local_session_shares
            .lock()
            .map_err(|_| "Failed to lock local share registry".to_string())?;
        shares.remove(&share_id)
    };

    if let Some(flag) = cancel_flag {
        flag.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        Err("Share not found or already expired.".to_string())
    }
}

#[tauri::command]
pub async fn import_session(
    state: State<'_, AppState>,
    content: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    let export: SessionExport = serde_json::from_str(&content)
        .map_err(|_| "Invalid session export format. Please provide a JSON export.".to_string())?;
    state.with_storage(|storage| storage.import_session(&export, workspace_path))
}

#[tauri::command]
pub async fn write_export_file(
    output_path: String,
    content: String,
) -> Result<(), String> {
    std::fs::write(&output_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn parse_ast(
    workspace_path: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    use crate::domain::treesitter;

    let workspace = PathBuf::from(&workspace_path);
    let full_path = workspace.join(&file_path);

    let canonical_workspace = workspace.canonicalize()
        .unwrap_or_else(|_| workspace.clone());
    let canonical_path = std::fs::canonicalize(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    if !canonical_path.starts_with(&canonical_workspace) {
        return Err("Access denied: Path is outside workspace".to_string());
    }

    let content = tokio::fs::read_to_string(&canonical_path).await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let lang = treesitter::detect_language(&canonical_path)
        .ok_or_else(|| "Unsupported file type for AST parsing".to_string())?;

    let lang_str = lang.as_str().to_string();
    let symbols = treesitter::extract_symbols(&content, &lang);
    let count = symbols.len();

    Ok(serde_json::json!({
        "symbols": symbols,
        "count": count,
        "path": file_path,
        "language": lang_str
    }))
}

#[tauri::command]
pub async fn git_status_summary(
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    use crate::adapters::tools::git::GitTool;
    use crate::domain::ports::Tool;

    let path = PathBuf::from(&workspace_path);
    let tool = GitTool::new(path);
    let input = serde_json::json!({
        "command": "status"
    });

    tool.execute(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_file_at_head(
    workspace_path: String,
    file_path: String,
) -> Result<String, String> {
    use git2::Repository;
    use std::path::Path;

    let repo = Repository::open(&workspace_path)
        .map_err(|e| format!("Failed to open git repository: {}", e))?;
    let head = repo.head().map_err(|e| format!("Failed to read HEAD: {}", e))?;
    let commit = head.peel_to_commit().map_err(|e| format!("Failed to get commit: {}", e))?;
    let tree = commit.tree().map_err(|e| format!("Failed to get tree: {}", e))?;

    let repo_root = Path::new(&workspace_path);
    let relative_path = Path::new(&file_path)
        .strip_prefix(repo_root)
        .map_err(|_| "File is not within workspace".to_string())?;

    let entry = tree.get_path(relative_path)
        .map_err(|_| "File not found in HEAD".to_string())?;
    let object = entry.to_object(&repo)
        .map_err(|e| format!("Failed to read object: {}", e))?;
    let blob = object.as_blob().ok_or("Object is not a blob".to_string())?;
    let content = String::from_utf8_lossy(blob.content()).to_string();
    Ok(content)
}

#[tauri::command]
pub async fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.with_storage(|storage| storage.delete_session(&session_id))
}

#[tauri::command]
pub async fn rename_session(
    state: State<'_, AppState>,
    session_id: String,
    name: Option<String>,
) -> Result<(), String> {
    state.with_storage(|storage| storage.rename_session(&session_id, name))
}

#[tauri::command]
pub async fn replay_session(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    session_id: String,
    model_id: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let original_session = state.with_storage(|storage| storage.load_session(&session_id))?;

    let uuid = original_session.id;
    let path = original_session.workspace_path.clone();

    let api_key = api_key.unwrap_or_default();
    let model_id_value = model_id.unwrap_or_else(|| original_session.model.0.clone());

    let provider = if model_id_value.starts_with("llama")
        || model_id_value.starts_with("mistral")
        || model_id_value.starts_with("codellama")
        || model_id_value.starts_with("deepseek") {
        "ollama".to_string()
    } else if model_id_value.starts_with("gemini") {
        "gemini".to_string()
    } else if model_id_value.starts_with("claude") {
        "anthropic".to_string()
    } else {
        "openai".to_string()
    };

    let model = build_model_adapter(&provider, &api_key, &model_id_value, None)?;

    let mut config_manager = crate::config::ConfigManager::new();
    let _ = config_manager.load(Some(&path));
    let config = config_manager.config();
    let permission_manager = Arc::new(tokio::sync::Mutex::new(config.permission.clone()));

    let mut tools: Vec<Arc<dyn crate::domain::ports::Tool>> = vec![
        Arc::new(ReadFileTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(WriteFileTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(LspTool::new(
            path.clone(),
            permission_manager.clone(),
            config.lsp.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(EditFileTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone(), permission_manager.clone())),
        Arc::new(ListTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
        Arc::new(TodoReadTool::new(path.clone())),
        Arc::new(SkillTool::new(
            path.clone(),
            uuid.to_string(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
    ];

    // Load MCP tools from configuration
    match load_mcp_tools(&path).await {
        Ok(mcp_tools) => {
            tools.extend(mcp_tools);
        }
        Err(e) => {
            println!("⚠️  Warning: Failed to load MCP tools: {}", e);
        }
    }

    let new_session = AgentSession {
        id: uuid,
        workspace_path: path.clone(),
        model: ModelId(model_id_value),
        mode: original_session.mode,
        messages: original_session.messages,
        permissions: AgentPermissions { 
            config: config.permission.clone() 
        },
    };

    let agent = Agent::new(
        new_session,
        model,
        tools,
        permission_manager,
        Some(app.clone()),
        Some(state.pending_confirmations.clone()),
    );

    let mut agents = state.agents.lock().await;
    agents.insert(uuid, Arc::new(Mutex::new(agent)));

    crate::config::start_config_watcher(
        state.agents.clone(),
        state.config_watchers.clone(),
        path.clone(),
    );

    Ok(uuid.to_string())
}

#[tauri::command]
pub async fn init_orchestrator(
    state: State<'_, AppState>,
    workspace_path: String,
) -> Result<(), String> {
    let mut orchestrator_guard: tokio::sync::MutexGuard<Option<Orchestrator>> = state.orchestrator.lock().await;
    if orchestrator_guard.is_none() {
        *orchestrator_guard = Some(Orchestrator::new(PathBuf::from(workspace_path)));
    }
    Ok(())
}

#[tauri::command]
pub async fn add_agent_to_orchestrator(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    role: String,
    model_id: String,
    api_key: String,
    provider: String,
    workspace_path: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|_| "Invalid Agent UUID")?;
    let role_enum = match role.to_lowercase().as_str() {
        "coder" => AgentRole::Coder,
        "reviewer" => AgentRole::Reviewer,
        "planner" => AgentRole::Planner,
        "debugger" => AgentRole::Debugger,
        _ => AgentRole::Generic,
    };

    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    if provider != "ollama" && api_key.trim().is_empty() {
        return Err(format!(
            "Missing API credential for provider '{}'. Connect OAuth/API key in Settings first.",
            provider
        ));
    }

    let model = build_model_adapter(&provider, &api_key, &model_id, None)?;

    let path = PathBuf::from(workspace_path);
    
    let mut config_manager = crate::config::ConfigManager::new();
    let _ = config_manager.load(Some(&path));
    let config = config_manager.config();
    let permission_manager = Arc::new(tokio::sync::Mutex::new(config.permission.clone()));

    let mut tools: Vec<Arc<dyn crate::domain::ports::Tool>> = vec![
        Arc::new(ReadFileTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(WriteFileTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(BashTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(GitTool::new(path.clone())),
        Arc::new(SearchTool::new(path.clone())),
        Arc::new(LspTool::new(
            path.clone(),
            permission_manager.clone(),
            config.lsp.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone()
        )),
        Arc::new(EditFileTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
        Arc::new(SymbolsTool::new(path.clone())),
        Arc::new(GlobTool::new(path.clone(), permission_manager.clone())),
        Arc::new(ListTool::new(path.clone(), permission_manager.clone())),
        Arc::new(WebFetchTool::new()),
        Arc::new(PatchTool::new(path.clone())),
        Arc::new(QuestionTool::new(app.clone())),
        Arc::new(TodoWriteTool::new(path.clone())),
        Arc::new(TodoReadTool::new(path.clone())),
        Arc::new(SkillTool::new(
            path.clone(),
            agent_id.clone(),
            app.clone(),
            state.pending_confirmations.clone(),
            permission_manager.clone()
        )),
    ];

    // Load MCP tools from configuration
    match load_mcp_tools(&path).await {
        Ok(mcp_tools) => {
            tools.extend(mcp_tools);
        }
        Err(e) => {
            println!("⚠️  Warning: Failed to load MCP tools: {}", e);
        }
    }

    orchestrator
        .add_agent(
            uuid,
            role_enum,
            ModelId(model_id),
            model,
            tools,
            AgentMode::Build
        )
        .await
}

#[tauri::command]
pub async fn remove_agent_from_orchestrator(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&agent_id).map_err(|_| "Invalid Agent UUID")?;
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    orchestrator.remove_agent(uuid).await
}

#[tauri::command]
pub async fn create_task(
    state: State<'_, AppState>,
    description: String,
    dependency_ids: Option<Vec<String>>,
    preferred_agent_id: Option<String>,
    group_id: Option<String>,
    group_mode: Option<String>,
) -> Result<String, String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    let mut dependencies = Vec::new();
    if let Some(ids) = dependency_ids {
        for id in ids {
            dependencies.push(Uuid::parse_str(&id).map_err(|_| format!("Invalid dependency task UUID: {}", id))?);
        }
    }

    let preferred_agent = match preferred_agent_id {
        Some(id) if !id.trim().is_empty() => {
            Some(Uuid::parse_str(&id).map_err(|_| format!("Invalid preferred agent UUID: {}", id))?)
        }
        _ => None,
    };

    let normalized_group_id = group_id
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

    let parsed_group_mode = match group_mode.as_ref().map(|value| value.trim().to_lowercase()) {
        Some(value) if value == "sequential" => Some(GroupExecutionMode::Sequential),
        Some(value) if value == "parallel" => Some(GroupExecutionMode::Parallel),
        Some(value) => return Err(format!("Invalid task group mode: {}", value)),
        None => None,
    };

    let task_id = orchestrator
        .create_task(
            description,
            dependencies,
            preferred_agent,
            normalized_group_id,
            parsed_group_mode,
        )
        .await;
    Ok(task_id.to_string())
}

#[tauri::command]
pub async fn process_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    orchestrator.process_tasks().await
}

#[tauri::command]
pub async fn cancel_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&task_id).map_err(|_| "Invalid Task UUID")?;
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    orchestrator.cancel_task(uuid).await
}

#[tauri::command]
pub async fn retry_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&task_id).map_err(|_| "Invalid Task UUID")?;
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    orchestrator.retry_task(uuid).await
}

#[tauri::command]
pub async fn set_orchestrator_execution_mode(
    state: State<'_, AppState>,
    mode: String,
) -> Result<(), String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    let normalized = mode.trim().to_lowercase();
    let execution_mode = match normalized.as_str() {
        "sequential" => ExecutionMode::Sequential,
        "parallel" => ExecutionMode::Parallel,
        _ => return Err(format!("Invalid orchestration execution mode: {}", mode)),
    };

    orchestrator.set_execution_mode(execution_mode).await;
    Ok(())
}

#[tauri::command]
pub async fn get_orchestrator_execution_mode(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    let mode = orchestrator.get_execution_mode().await;
    let value = match mode {
        ExecutionMode::Sequential => "sequential",
        ExecutionMode::Parallel => "parallel",
    };
    Ok(value.to_string())
}

#[tauri::command]
pub async fn get_all_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<Task>, String> {
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    Ok(orchestrator.get_all_tasks().await)
}

#[tauri::command]
pub async fn get_task_status(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<TaskStatus, String> {
    let uuid = Uuid::parse_str(&task_id).map_err(|_| "Invalid Task UUID")?;
    let orchestrator = {
        let orchestrator_guard = state.orchestrator.lock().await;
        orchestrator_guard.as_ref().ok_or("Orchestrator not initialized")?.clone()
    };

    let status = orchestrator.get_task_status(uuid).await;
    status.ok_or("Task not found".to_string())
}

#[tauri::command]
pub fn resolve_question(
    question_id: String,
    answers: Value,
) -> Result<(), String> {
    crate::adapters::tools::question::QuestionTool::resolve_question(question_id, answers)
}

#[tauri::command]
pub async fn read_todos(
    workspace_path: String,
    filter: Option<String>,
) -> Result<Value, String> {
    use crate::adapters::tools::todoread::TodoReadTool;
    use crate::domain::ports::Tool;
    
    let path = PathBuf::from(&workspace_path);
    let tool = TodoReadTool::new(path);
    
    let filter_str = filter.unwrap_or_else(|| "all".to_string());
    
    let input = json!({
        "filter": filter_str
    });
    
    tool.execute(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_todo(
    workspace_path: String,
    action: String,
    id: Option<String>,
    content: Option<String>,
    status: Option<String>,
    priority: Option<String>,
) -> Result<Value, String> {
    use crate::adapters::tools::todo::TodoWriteTool;
    use crate::domain::ports::Tool;
    
    let path = PathBuf::from(&workspace_path);
    let tool = TodoWriteTool::new(path);
    
    let mut input = json!({
        "action": action
    });
    
    if let Some(id_val) = id {
        input["id"] = json!(id_val);
    }
    
    if let Some(content_val) = content {
        input["content"] = json!(content_val);
    }
    
    if let Some(status_val) = status {
        input["status"] = json!(status_val);
    }
    
    if let Some(priority_val) = priority {
        input["priority"] = json!(priority_val);
    }
    
    tool.execute(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_tree(path: String) -> Result<Vec<serde_json::Value>, String> {
    use crate::adapters::tools::list::ListTool;
    use crate::domain::ports::Tool;
    
    let path_buf = PathBuf::from(&path);
    let permission_manager = std::sync::Arc::new(tokio::sync::Mutex::new(crate::config::PermissionConfig::default()));
    let tool = ListTool::new(path_buf.clone(), permission_manager);
    
    let input = serde_json::json!({
        "path": ".",
        "depth": 10,
        "show_hidden": false,
        "filter": "all"
    });
    
    let result = tool.execute(input).await.map_err(|e| e.to_string())?;
    
    // Convert list entries to file tree format
    let entries = result.get("entries")
        .and_then(|e| e.as_array())
        .ok_or("Failed to get entries")?;
    
    let nodes: Vec<serde_json::Value> = entries.iter().map(|entry| {
        let kind = entry.get("kind").and_then(|k| k.as_str()).unwrap_or("file");
        let name = entry.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
        let entry_path = entry.get("path").and_then(|p| p.as_str()).unwrap_or("");
        
        serde_json::json!({
            "name": name,
            "path": format!("{}/{}", path, entry_path),
            "kind": kind,
            "children": null
        })
    }).collect();
    
    Ok(nodes)
}

#[tauri::command]
pub async fn search(
    workspace_path: String,
    pattern: String,
) -> Result<serde_json::Value, String> {
    use crate::adapters::tools::search::SearchTool;
    use crate::domain::ports::Tool;
    
    let path = PathBuf::from(&workspace_path);
    let tool = SearchTool::new(path);
    
    let input = serde_json::json!({
        "pattern": pattern,
        "path": "."
    });
    
    tool.execute(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_skills(
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    use crate::config::SkillDiscovery;
    
    let path = PathBuf::from(&workspace_path);
    let skills = SkillDiscovery::discover(&path)
        .map_err(|e| e.to_string())?;
    
    let skill_list: Vec<serde_json::Value> = skills.iter().map(|skill| {
        serde_json::json!({
            "name": skill.name,
            "path": skill.path.to_string_lossy().to_string(),
            "source": match skill.source {
                crate::config::SkillSource::Project => "project",
                crate::config::SkillSource::Global => "global",
            }
        })
    }).collect();
    
    Ok(serde_json::json!({
        "skills": skill_list,
        "count": skill_list.len()
    }))
}

/// Test MCP connection to a server
#[tauri::command]
pub async fn test_mcp_connection(
    transport_type: String,
    command: Option<Vec<String>>,
    url: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    use crate::mcp::{McpClient, McpServerConfig, TransportType};
    
    let transport = match transport_type.to_lowercase().as_str() {
        "stdio" => TransportType::Stdio,
        "http" => TransportType::Http,
        _ => return Err(format!("Invalid transport type: {}. Use 'stdio' or 'http'", transport_type)),
    };
    
    let config = McpServerConfig {
        server_name: "test-server".to_string(),
        transport_type: transport,
        command,
        url,
        env,
        headers: None,
        enabled: true,
        timeout_ms: 30000,
    };
    
    println!("🔌 Creating MCP client...");
    let client = McpClient::new(config).await
        .map_err(|e| format!("Failed to create MCP client: {}", e))?;
    
    println!("🔌 Initializing MCP connection...");
    client.initialize().await
        .map_err(|e| format!("Failed to initialize: {}", e))?;
    
    println!("✅ MCP connection initialized!");
    
    // Get capabilities
    let caps = client.get_capabilities().await;
    println!("📋 Server capabilities: {:?}", caps);
    
    // List tools
    let tools = client.get_tools().await;
    println!("📦 Found {} tools:", tools.len());
    for tool in &tools {
        println!("  - {}: {}", tool.name, tool.description);
    }
    
    // Close connection
    let _ = client.close().await;
    println!("🔌 Connection closed");
    
    Ok(serde_json::json!({
        "success": true,
        "tool_count": tools.len(),
        "tools": tools.iter().map(|t| serde_json::json!({
            "name": t.name,
            "description": t.description
        })).collect::<Vec<_>>()
    }))
}

/// List tools from an MCP server without full initialization
#[tauri::command]
pub async fn list_mcp_tools(
    transport_type: String,
    command: Option<Vec<String>>,
    url: Option<String>,
) -> Result<serde_json::Value, String> {
    use crate::mcp::{McpClient, McpServerConfig, TransportType};
    
    let transport = match transport_type.to_lowercase().as_str() {
        "stdio" => TransportType::Stdio,
        "http" => TransportType::Http,
        _ => return Err(format!("Invalid transport type: {}. Use 'stdio' or 'http'", transport_type)),
    };
    
    let config = McpServerConfig {
        server_name: "tools-server".to_string(),
        transport_type: transport,
        command,
        url,
        env: None,
        headers: None,
        enabled: true,
        timeout_ms: 30000,
    };
    
    let client = McpClient::new(config).await
        .map_err(|e| format!("Failed to create MCP client: {}", e))?;
    
    client.initialize().await
        .map_err(|e| format!("Failed to initialize: {}", e))?;
    
    let tools = client.get_tools().await;
    
    let _ = client.close().await;
    
    Ok(serde_json::json!({
        "success": true,
        "count": tools.len(),
        "tools": tools.iter().map(|t| serde_json::json!({
            "name": t.name,
            "description": t.description
        })).collect::<Vec<_>>()
    }))
}

/// Load MCP configuration from anvil.json
    #[tauri::command]
    pub async fn load_mcp_config(
        _state: State<'_, AppState>,
        workspace_path: String,
    ) -> Result<serde_json::Value, String> {
        let path = PathBuf::from(&workspace_path);
        
        let mut config_manager = crate::config::ConfigManager::new();
        let _ = config_manager.load(Some(&path));
        let config = config_manager.config();
        
        let mcp_config = config.mcp.as_ref();
    
    let enabled_servers: Vec<serde_json::Value> = if let Some(mcp) = mcp_config {
        let servers = mcp.get_servers();
        
        servers.iter().filter(|s| s.enabled).map(|server| {
            serde_json::json!({
                "name": server.name,
                "transport_type": match server.transport_type {
                    crate::mcp::TransportType::Stdio => "stdio",
                    crate::mcp::TransportType::Http => "http",
                },
                "enabled": server.enabled,
                "timeout_ms": server.timeout_ms,
                "command": server.command,
                "url": server.url,
                "env": server.env,
                "headers": server.headers
            })
        }).collect()
    } else {
        Vec::new()
    };
    
    let mcp_enabled = mcp_config
        .and_then(|m| m.enabled)
        .unwrap_or(false);
    
    Ok(serde_json::json!({
        "enabled": mcp_enabled,
        "server_count": enabled_servers.len(),
        "servers": enabled_servers
    }))
}

/// Get all MCP tools from configured servers
    #[tauri::command]
    pub async fn get_all_mcp_tools(
        _state: State<'_, AppState>,
        workspace_path: String,
    ) -> Result<serde_json::Value, String> {
        let path = PathBuf::from(&workspace_path);
        
        let mut config_manager = crate::config::ConfigManager::new();
        let _ = config_manager.load(Some(&path));
        let config = config_manager.config();
    
    let mcp_config = config.mcp.as_ref();
    
    if mcp_config.is_none() || mcp_config.and_then(|m| m.enabled).unwrap_or(false) {
        return Ok(serde_json::json!({
            "enabled": false,
            "tools": []
        }));
    }
    
    let mcp = mcp_config.unwrap();
    let servers = mcp.get_servers();
    let enabled_servers: Vec<_> = servers.iter().filter(|s| s.enabled).collect();
    
    let mut all_tools = Vec::new();
    let mut tool_server_map = std::collections::HashMap::new();
    
    for server in &enabled_servers {
        match server.transport_type {
            crate::mcp::TransportType::Stdio => {
                if let Some(command) = &server.command {
                    let mcp_config = crate::mcp::McpServerConfig {
                        server_name: server.name.clone(),
                        transport_type: crate::mcp::TransportType::Stdio,
                        command: Some(command.clone()),
                        url: None,
                        env: server.env.clone(),
                        headers: None,
                        enabled: true,
                        timeout_ms: server.timeout_ms,
                    };
                    
                    match crate::mcp::McpClient::new(mcp_config).await {
                        Ok(client) => {
                            if let Err(e) = client.initialize().await {
                                println!("⚠️  Failed to connect to {}: {}", server.name, e);
                            } else {
                                let tools = client.get_tools().await;
                                for tool in &tools {
                                    let prefixed_name = format!("{}_{}", server.name, tool.name);
                                    tool_server_map.insert(prefixed_name.clone(), server.name.clone());
                                    all_tools.push(serde_json::json!({
                                        "name": prefixed_name,
                                        "original_name": tool.name,
                                        "server": server.name,
                                        "description": tool.description,
                                        "input_schema": tool.input_schema
                                    }));
                                }
                            }
                            let _ = client.close().await;
                        }
                        Err(e) => {
                            println!("⚠️  Failed to create client for {}: {}", server.name, e);
                        }
                    }
                }
            }
            crate::mcp::TransportType::Http => {
                // HTTP servers support - similar to stdio but with URL
                if let Some(url) = &server.url {
                    let mcp_config = crate::mcp::McpServerConfig {
                        server_name: server.name.clone(),
                        transport_type: crate::mcp::TransportType::Http,
                        command: None,
                        url: Some(url.clone()),
                        env: None,
                        headers: server.headers.clone(),
                        enabled: true,
                        timeout_ms: server.timeout_ms,
                    };
                    
                    match crate::mcp::McpClient::new(mcp_config).await {
                        Ok(client) => {
                            if let Err(e) = client.initialize().await {
                                println!("⚠️  Failed to connect to {}: {}", server.name, e);
                            } else {
                                let tools = client.get_tools().await;
                                for tool in &tools {
                                    let prefixed_name = format!("{}_{}", server.name, tool.name);
                                    tool_server_map.insert(prefixed_name.clone(), server.name.clone());
                                    all_tools.push(serde_json::json!({
                                        "name": prefixed_name,
                                        "original_name": tool.name,
                                        "server": server.name,
                                        "description": tool.description,
                                        "input_schema": tool.input_schema
                                    }));
                                }
                            }
                            let _ = client.close().await;
                        }
                        Err(e) => {
                            println!("⚠️  Failed to create client for {}: {}", server.name, e);
                        }
                    }
                }
            }
        }
    }
    
    Ok(serde_json::json!({
        "enabled": true,
        "tool_count": all_tools.len(),
        "servers": enabled_servers.len(),
        "tools": all_tools
    }))
}

/// Call an MCP tool with arguments
#[tauri::command]
pub async fn call_mcp_tool(
    transport_type: String,
    command: Option<Vec<String>>,
    url: Option<String>,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use crate::mcp::{McpClient, McpServerConfig, TransportType};
    
    let transport = match transport_type.to_lowercase().as_str() {
        "stdio" => TransportType::Stdio,
        "http" => TransportType::Http,
        _ => return Err(format!("Invalid transport type: {}. Use 'stdio' or 'http'", transport_type)),
    };
    
    let config = McpServerConfig {
        server_name: "tool-caller".to_string(),
        transport_type: transport,
        command,
        url,
        env: None,
        headers: None,
        enabled: true,
        timeout_ms: 30000,
    };
    
    let client = McpClient::new(config).await
        .map_err(|e| format!("Failed to create MCP client: {}", e))?;
    
    client.initialize().await
        .map_err(|e| format!("Failed to initialize: {}", e))?;
    
    let result = client.call_tool(&tool_name, arguments).await
        .map_err(|e| format!("Failed to call tool: {}", e))?;
    
    let _ = client.close().await;
    
    Ok(serde_json::json!({
        "success": true,
        "result": result
    }))
}

/// Save MCP configuration to anvil.json
#[tauri::command]
pub async fn save_mcp_config(
    workspace_path: String,
    config: serde_json::Value,
) -> Result<(), String> {
    let path = PathBuf::from(&workspace_path).join(".anvil").join("anvil.json");

    // Load existing config or create new
    let mut root_config: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };
    
    // Update MCP section
    // config received is the McpConfig object (enabled, servers, etc.)
    // We need to put it under "mcp" key
    if let Some(obj) = root_config.as_object_mut() {
        obj.insert("mcp".to_string(), config);
    } else {
        return Err("Invalid anvil.json format: root is not an object".to_string());
    }

    write_json_atomic(&path, &root_config)?;

    Ok(())
}

fn local_config_path(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(".anvil").join("anvil.json")
}

fn trim_permission_patterns(config: &mut PermissionConfig) {
    let trim = |rules: &mut Vec<crate::config::PermissionRule>| {
        for rule in rules {
            rule.pattern = rule.pattern.trim().to_string();
        }
    };

    trim(&mut config.bash.rules);
    trim(&mut config.edit.rules);
    trim(&mut config.read.rules);
    trim(&mut config.write.rules);
    trim(&mut config.skill.rules);
    trim(&mut config.list.rules);
    trim(&mut config.glob.rules);
    trim(&mut config.grep.rules);
    trim(&mut config.webfetch.rules);
    trim(&mut config.task.rules);
    trim(&mut config.lsp.rules);
    trim(&mut config.todoread.rules);
    trim(&mut config.todowrite.rules);
    trim(&mut config.doom_loop.rules);

    if !config.extra_tools.is_empty() {
        let mut normalized = HashMap::new();
        for (tool_name, mut permission) in config.extra_tools.drain() {
            let trimmed_name = tool_name.trim().to_string();
            if trimmed_name.is_empty() {
                continue;
            }
            for rule in &mut permission.rules {
                rule.pattern = rule.pattern.trim().to_string();
            }
            normalized.insert(trimmed_name, permission);
        }
        config.extra_tools = normalized;
    }

    if let Some(external_directory) = config.external_directory.take() {
        let mut normalized = HashMap::new();
        for (pattern, action) in external_directory {
            let trimmed = pattern.trim().to_string();
            if !trimmed.is_empty() {
                normalized.insert(trimmed, action);
            }
        }
        if !normalized.is_empty() {
            config.external_directory = Some(normalized);
        }
    }
}

fn validate_permission_config(config: &PermissionConfig) -> Result<(), String> {
    let validate_tool = |tool_name: &str, rules: &[crate::config::PermissionRule]| -> Result<(), String> {
        for (index, rule) in rules.iter().enumerate() {
            if rule.pattern.trim().is_empty() {
                return Err(format!(
                    "Invalid permission config: permission.{}.rules[{}].pattern cannot be empty.",
                    tool_name, index
                ));
            }
        }
        Ok(())
    };

    validate_tool("bash", &config.bash.rules)?;
    validate_tool("edit", &config.edit.rules)?;
    validate_tool("read", &config.read.rules)?;
    validate_tool("write", &config.write.rules)?;
    validate_tool("skill", &config.skill.rules)?;
    validate_tool("list", &config.list.rules)?;
    validate_tool("glob", &config.glob.rules)?;
    validate_tool("grep", &config.grep.rules)?;
    validate_tool("webfetch", &config.webfetch.rules)?;
    validate_tool("task", &config.task.rules)?;
    validate_tool("lsp", &config.lsp.rules)?;
    validate_tool("todoread", &config.todoread.rules)?;
    validate_tool("todowrite", &config.todowrite.rules)?;
    validate_tool("doom_loop", &config.doom_loop.rules)?;
    for (tool_name, permission) in &config.extra_tools {
        if tool_name.trim().is_empty() {
            return Err("Invalid permission config: dynamic tool names cannot be empty.".to_string());
        }
        validate_tool(tool_name, &permission.rules)?;
    }

    if let Some(external_directory) = &config.external_directory {
        for pattern in external_directory.keys() {
            if pattern.trim().is_empty() {
                return Err(
                    "Invalid permission config: permission.external_directory keys cannot be empty."
                        .to_string(),
                );
            }
        }
    }

    Ok(())
}

fn write_json_atomic(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let payload = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("anvil.json");
    let temp_name = format!(".{}.tmp-{}", file_name, Uuid::new_v4());
    let temp_path = path.with_file_name(temp_name);

    std::fs::write(&temp_path, payload).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }

    if let Err(error) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error.to_string());
    }

    Ok(())
}

/// Save permission configuration to global anvil.json
#[tauri::command]
pub async fn save_permission_config(
    state: State<'_, AppState>,
    workspace_path: String,
    mut config: PermissionConfig,
) -> Result<(), String> {
    let path = local_config_path(&workspace_path);
    trim_permission_patterns(&mut config);
    validate_permission_config(&config)?;

    // Load existing config or create new
    let mut root_config: serde_json::Value = if path.exists() {
        let content =
                std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };
    
    // Update permission field
    if let Some(obj) = root_config.as_object_mut() {
        obj.insert("permission".to_string(), serde_json::to_value(&config).map_err(|e| e.to_string())?);
    } else {
        return Err("Invalid anvil.json format: root is not an object".to_string());
    }

    write_json_atomic(&path, &root_config)?;
    
    let mut agents = state.agents.lock().await;
    for (_, agent_arc) in agents.iter_mut() {
        let mut agent = agent_arc.lock().await;
        if agent.session.workspace_path == PathBuf::from(&workspace_path) {
            {
                let mut perms = agent.permission_manager.lock().await;
                *perms = config.clone();
            }
            agent.session.permissions.config = config.clone();
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn list_workflows(
    workspace_path: String,
) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(&workspace_path);
    let workflows = crate::workflows::list_workflows(&path).await?;
    let items: Vec<serde_json::Value> = workflows
        .into_iter()
        .map(|workflow| {
            serde_json::json!({
                "id": workflow.id,
                "name": workflow.name,
                "description": workflow.description,
                "version": workflow.version,
                "created_at": workflow.created_at,
                "updated_at": workflow.updated_at,
                "steps": workflow.steps.len()
            })
        })
        .collect();

    Ok(serde_json::json!({
        "workflows": items,
        "count": items.len()
    }))
}

#[tauri::command]
pub async fn load_workflow(
    workspace_path: String,
    workflow_id: String,
) -> Result<Workflow, String> {
    let path = PathBuf::from(&workspace_path);
    crate::workflows::load_workflow(&path, &workflow_id).await
}

#[tauri::command]
pub async fn save_workflow(
    workspace_path: String,
    workflow: Workflow,
) -> Result<Workflow, String> {
    let path = PathBuf::from(&workspace_path);
    crate::workflows::save_workflow(&path, workflow).await
}

#[tauri::command]
pub async fn delete_workflow(
    workspace_path: String,
    workflow_id: String,
) -> Result<(), String> {
    let path = PathBuf::from(&workspace_path);
    crate::workflows::delete_workflow(&path, &workflow_id).await
}

/// Load effective permission configuration for a workspace.
#[tauri::command]
pub async fn load_permission_config(
    workspace_path: String,
) -> Result<Option<PermissionConfig>, String> {
    let path = PathBuf::from(&workspace_path);
    let mut config_manager = crate::config::ConfigManager::new();
    config_manager
        .load(Some(&path))
        .map_err(|e| format!("Failed to load permission config: {}", e))?;
    let config = config_manager.config();

    Ok(Some(config.permission.clone()))
}
