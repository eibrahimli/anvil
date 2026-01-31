use crate::domain::ports::Tool;
use crate::domain::models::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::PathBuf;
use ignore::WalkBuilder;
use grep::searcher::Searcher;
use grep::searcher::sinks::UTF8;
use grep::regex::RegexMatcher;
use std::sync::{Arc, Mutex};

pub struct SearchTool {
    pub workspace_root: PathBuf,
}

impl SearchTool {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }
}

#[derive(serde::Serialize)]
struct SearchMatch {
    path: String,
    line_number: u64,
    content: String,
}

#[async_trait]
impl Tool for SearchTool {
    fn name(&self) -> &'static str {
        "search"
    }

    fn schema(&self) -> Value {
        json!({
            "name": "search",
            "description": "Search for a pattern in the codebase using regex. Respects .gitignore.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for"
                    },
                    "include": {
                        "type": "string",
                        "description": "Optional glob pattern for files to include"
                    }
                },
                "required": ["pattern"]
            }
        })
    }

    async fn execute(&self, input: Value) -> ToolResult {
        let pattern = input.get("pattern")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'pattern' parameter")?;

        let matcher = RegexMatcher::new(pattern)
            .map_err(|e| format!("Invalid regex: {}", e))?;
        
        let matches = Arc::new(Mutex::new(Vec::new()));
        let mut searcher = Searcher::new();
        
        let root = self.workspace_root.clone();
        let matches_clone = Arc::clone(&matches);

        // Run search in a blocking thread since ignore/grep are synchronous
        tokio::task::spawn_blocking(move || {
            let walker = WalkBuilder::new(&root)
                .hidden(false)
                .git_ignore(true)
                .build();

            for result in walker {
                let entry = match result {
                    Ok(entry) => entry,
                    Err(_) => continue,
                };

                if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                    continue;
                }

                let path = entry.path().to_owned();
                let relative_path = path.strip_prefix(&root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();

                let matches_inner = Arc::clone(&matches_clone);
                let _ = searcher.search_path(
                    &matcher,
                    &path,
                    UTF8(|line_num, line| {
                        let mut m = matches_inner.lock().unwrap();
                        m.push(SearchMatch {
                            path: relative_path.clone(),
                            line_number: line_num,
                            content: line.trim_end().to_string(),
                        });
                        if m.len() > 500 {
                            return Ok(false); // Cap results
                        }
                        Ok(true)
                    }),
                );
            }
        }).await.map_err(|e| e.to_string())?;

        let final_matches = matches.lock().unwrap();
        Ok(json!({
            "matches": *final_matches,
            "count": final_matches.len()
        }))
    }
}
