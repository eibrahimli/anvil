use regex::Regex;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use crate::domain::treesitter;

pub struct ContextBuilder;

impl ContextBuilder {
    pub fn build(workspace_root: &Path) -> String {
        let mut context = String::from("Workspace Context:\n");

        // Add file tree (depth 3)
        context.push_str("File Structure (up to depth 3):\n");
        for entry in WalkDir::new(workspace_root)
            .max_depth(3)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            let name = path.strip_prefix(workspace_root).unwrap_or(path);

            // Skip common ignore directories
            if name.to_string_lossy().contains(".git")
                || name.to_string_lossy().contains("node_modules")
                || name.to_string_lossy().contains("target")
            {
                continue;
            }

            let depth = entry.depth();
            let indent = "  ".repeat(depth);
            context.push_str(&format!("{}{}\n", indent, name.display()));
        }

        // Add semantic summary of key entry-point files
        let summary = Self::build_files_summary(workspace_root);
        if !summary.is_empty() {
            context.push_str("\n\nKey Files Summary:\n");
            context.push_str(&summary);
        }

        // Process AGENTS.md with @file: support
        let agents_file = workspace_root.join("AGENTS.md");
        if agents_file.exists() {
            context.push_str("\n\nUser Instructions (from AGENTS.md):\n");
            let mut visited = HashSet::new();
            let content = Self::resolve_content(&agents_file, workspace_root, &mut visited);
            context.push_str(&content);
        }

        context
    }

    /// Walk the workspace looking for well-known entry-point files and return a
    /// brief semantic summary (language + top-level symbols) for each, capped at
    /// ~2 000 characters total.
    fn build_files_summary(workspace_root: &Path) -> String {
        // Candidate relative paths, searched in order of priority.
        let candidates: &[&str] = &[
            "src/main.rs",
            "src/lib.rs",
            "src-tauri/src/lib.rs",
            "src-tauri/src/main.rs",
            "src/main.ts",
            "src/main.tsx",
            "src/App.tsx",
            "src/App.ts",
            "src/index.ts",
            "src/index.tsx",
            "src/index.js",
            "main.py",
            "app.py",
            "src/main.py",
            "main.go",
            "cmd/main.go",
        ];

        let mut output = String::new();

        for rel in candidates {
            if output.len() >= 2_000 {
                break;
            }

            let full_path = workspace_root.join(rel);
            if !full_path.exists() {
                continue;
            }

            let content = match fs::read_to_string(&full_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            if let Some(summary) = treesitter::summarize_file(&full_path, &content) {
                let names = if summary.top_level_names.is_empty() {
                    "(none)".to_string()
                } else {
                    summary.top_level_names.join(", ")
                };
                let line = format!(
                    "  [{lang}] {path} — {count} symbols: {names}\n",
                    lang = summary.language,
                    path = rel,
                    count = summary.symbol_count,
                    names = names,
                );
                // Hard-cap at 2000 chars so we don't blow up the context window.
                let remaining = 2_000_usize.saturating_sub(output.len());
                if line.len() <= remaining {
                    output.push_str(&line);
                } else {
                    output.push_str(&line[..remaining]);
                    break;
                }
            }
        }

        output
    }

    fn resolve_content(file_path: &Path, root: &Path, visited: &mut HashSet<PathBuf>) -> String {
        // Prevent infinite recursion and deduplicate includes
        // Canonicalize to ensure unique paths (handle symlinks, ../, etc)
        let abs_path = match fs::canonicalize(file_path) {
            Ok(p) => p,
            Err(_) => {
                return format!(
                    "\n[Warning: Could not resolve path {}]\n",
                    file_path.display()
                )
            }
        };

        if !visited.insert(abs_path.clone()) {
            return format!(
                "\n[Circular or Duplicate reference skipped: {}]\n",
                file_path.display()
            );
        }

        let content = match fs::read_to_string(&abs_path) {
            Ok(c) => c,
            Err(e) => return format!("\n[Error reading {}: {}]\n", file_path.display(), e),
        };

        // Regex to match @file:path/to/file on a line
        // Matches lines starting with @file: and captures the rest of the line
        let re = Regex::new(r"(?m)^@file:(.+)$").unwrap();

        let mut resolved_lines = Vec::new();

        for line in content.lines() {
            if let Some(caps) = re.captures(line) {
                let ref_path_str = caps.get(1).unwrap().as_str().trim();
                let ref_path = root.join(ref_path_str);

                resolved_lines.push(format!(
                    "\n--- Start of included file: {} ---",
                    ref_path_str
                ));
                resolved_lines.push(Self::resolve_content(&ref_path, root, visited));
                resolved_lines.push(format!("--- End of included file: {} ---\n", ref_path_str));
            } else {
                resolved_lines.push(line.to_string());
            }
        }

        resolved_lines.join("\n")
    }
}
