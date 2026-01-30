use std::path::Path;
use walkdir::WalkDir;

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

        context
    }
}
