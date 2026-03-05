//! Tree-sitter powered code intelligence for Anvil.
//!
//! Provides AST-based symbol extraction for Rust, TypeScript, TSX, JavaScript,
//! Python, Go, C, and Bash. Falls back gracefully for unsupported languages.

use serde::Serialize;
use std::path::Path;
use tree_sitter::{Node, Parser};

// ─── Language ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupportedLanguage {
    Rust,
    TypeScript,
    TSX,
    JavaScript,
    JSX,
    Python,
    Go,
    C,
    Bash,
}

impl SupportedLanguage {
    pub fn as_str(&self) -> &'static str {
        match self {
            SupportedLanguage::Rust => "rust",
            SupportedLanguage::TypeScript => "typescript",
            SupportedLanguage::TSX => "tsx",
            SupportedLanguage::JavaScript => "javascript",
            SupportedLanguage::JSX => "jsx",
            SupportedLanguage::Python => "python",
            SupportedLanguage::Go => "go",
            SupportedLanguage::C => "c",
            SupportedLanguage::Bash => "bash",
        }
    }
}

/// Detect language from a file's extension.
pub fn detect_language(path: &Path) -> Option<SupportedLanguage> {
    let ext = path.extension()?.to_str()?;
    match ext {
        "rs" => Some(SupportedLanguage::Rust),
        "ts" => Some(SupportedLanguage::TypeScript),
        "tsx" => Some(SupportedLanguage::TSX),
        "js" | "mjs" | "cjs" => Some(SupportedLanguage::JavaScript),
        "jsx" => Some(SupportedLanguage::JSX),
        "py" | "pyw" => Some(SupportedLanguage::Python),
        "go" => Some(SupportedLanguage::Go),
        "c" | "h" => Some(SupportedLanguage::C),
        "sh" | "bash" => Some(SupportedLanguage::Bash),
        _ => None,
    }
}

// ─── Symbol types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Struct,
    Enum,
    Trait,
    Interface,
    Constant,
    TypeAlias,
    Module,
}

#[derive(Debug, Clone, Serialize)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    /// 1-indexed start line (compatible with old regex-based API).
    pub line: usize,
    /// 1-indexed end line.
    pub line_end: usize,
    /// Enclosing class / impl / trait name when this symbol is nested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// First line of the declaration for display purposes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

// ─── File summary (for ContextBuilder) ───────────────────────────────────────

#[derive(Debug, Clone)]
pub struct FileSummary {
    pub language: String,
    pub symbol_count: usize,
    /// Top-level symbol names (no parent), capped at 20.
    pub top_level_names: Vec<String>,
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Parse `content` as `lang` and extract all symbols.
/// Returns an empty Vec if the language is unsupported or parsing fails.
pub fn extract_symbols(content: &str, lang: &SupportedLanguage) -> Vec<Symbol> {
    let mut parser = match make_parser(lang) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };

    let tree = match parser.parse(content, None) {
        Some(t) => t,
        None => return Vec::new(),
    };

    let mut symbols = Vec::new();
    let root = tree.root_node();
    let source = content.as_bytes();

    match lang {
        SupportedLanguage::Rust => walk_rust(root, source, None, &mut symbols),
        SupportedLanguage::TypeScript
        | SupportedLanguage::TSX
        | SupportedLanguage::JavaScript
        | SupportedLanguage::JSX => walk_js(root, source, None, &mut symbols),
        SupportedLanguage::Python => walk_python(root, source, None, &mut symbols),
        SupportedLanguage::Go => walk_go(root, source, None, &mut symbols),
        SupportedLanguage::C => walk_c(root, source, None, &mut symbols),
        SupportedLanguage::Bash => walk_bash(root, source, None, &mut symbols),
    }

    symbols.sort_by_key(|s| s.line);
    symbols
}

/// Summarize a file's symbols for injection into the agent context.
/// Returns `None` if the file extension is not supported.
pub fn summarize_file(path: &Path, content: &str) -> Option<FileSummary> {
    let lang = detect_language(path)?;
    let symbols = extract_symbols(content, &lang);

    let top_level_names: Vec<String> = symbols
        .iter()
        .filter(|s| s.parent.is_none())
        .map(|s| s.name.clone())
        .take(20)
        .collect();

    Some(FileSummary {
        language: lang.as_str().to_string(),
        symbol_count: symbols.len(),
        top_level_names,
    })
}

// ─── Parser factory ──────────────────────────────────────────────────────────

fn make_parser(lang: &SupportedLanguage) -> Result<Parser, String> {
    let mut parser = Parser::new();
    let language = match lang {
        SupportedLanguage::Rust => tree_sitter_rust::LANGUAGE.into(),
        SupportedLanguage::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        SupportedLanguage::TSX => tree_sitter_typescript::LANGUAGE_TSX.into(),
        SupportedLanguage::JavaScript | SupportedLanguage::JSX => {
            tree_sitter_javascript::LANGUAGE.into()
        }
        SupportedLanguage::Python => tree_sitter_python::LANGUAGE.into(),
        SupportedLanguage::Go => tree_sitter_go::LANGUAGE.into(),
        SupportedLanguage::C => tree_sitter_c::LANGUAGE.into(),
        SupportedLanguage::Bash => tree_sitter_bash::LANGUAGE.into(),
    };
    parser.set_language(&language).map_err(|e| e.to_string())?;
    Ok(parser)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn node_text<'a>(node: Node<'a>, source: &'a [u8]) -> &'a str {
    node.utf8_text(source).unwrap_or("")
}

/// Extract a compact signature: the first line of the node (capped at 150 chars).
fn signature(node: Node, source: &[u8]) -> Option<String> {
    let start_row = node.start_position().row;
    let text = std::str::from_utf8(source).ok()?;
    let first_line = text.lines().nth(start_row)?.trim();
    if first_line.is_empty() {
        return None;
    }
    if first_line.len() > 150 {
        Some(format!("{}...", &first_line[..147]))
    } else {
        Some(first_line.to_string())
    }
}

fn push_symbol(
    symbols: &mut Vec<Symbol>,
    name: String,
    kind: SymbolKind,
    node: Node,
    source: &[u8],
    parent: Option<&str>,
    include_sig: bool,
) {
    symbols.push(Symbol {
        name,
        kind,
        line: node.start_position().row + 1,
        line_end: node.end_position().row + 1,
        parent: parent.map(|p| p.to_string()),
        signature: if include_sig { signature(node, source) } else { None },
    });
}

// ─── Rust walker ─────────────────────────────────────────────────────────────

fn walk_rust(node: Node, source: &[u8], parent: Option<&str>, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let kind = if parent.is_some() {
                    SymbolKind::Method
                } else {
                    SymbolKind::Function
                };
                push_symbol(symbols, name, kind, node, source, parent, true);
            }
            // Don't recurse into function bodies — nested fns are too noisy.
            return;
        }
        "struct_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Struct, node, source, parent, false);
            }
            return;
        }
        "enum_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Enum, node, source, parent, false);
            }
            return;
        }
        "trait_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(
                    symbols,
                    name.clone(),
                    SymbolKind::Trait,
                    node,
                    source,
                    parent,
                    false,
                );
                // Recurse into trait body so methods appear with parent = trait name.
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    walk_rust(child, source, Some(&name), symbols);
                }
            }
            return;
        }
        "impl_item" => {
            // Extract the type being implemented (strip generic params for clarity).
            let impl_type = node
                .child_by_field_name("type")
                .map(|n| node_text(n, source).to_string());
            let effective_parent = impl_type.as_deref().or(parent);
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                walk_rust(child, source, effective_parent, symbols);
            }
            return;
        }
        "type_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::TypeAlias, node, source, parent, true);
            }
            return;
        }
        "const_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Constant, node, source, parent, true);
            }
            return;
        }
        "mod_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(
                    symbols,
                    name.clone(),
                    SymbolKind::Module,
                    node,
                    source,
                    parent,
                    false,
                );
                // Recurse so items inside inline mods are captured.
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    walk_rust(child, source, Some(&name), symbols);
                }
            }
            return;
        }
        _ => {}
    }

    // Default: recurse into all children.
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_rust(child, source, parent, symbols);
    }
}

// ─── TypeScript / JavaScript walker ──────────────────────────────────────────

fn walk_js(node: Node, source: &[u8], parent: Option<&str>, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_declaration" | "generator_function_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let kind = if parent.is_some() {
                    SymbolKind::Method
                } else {
                    SymbolKind::Function
                };
                push_symbol(symbols, name, kind, node, source, parent, true);
            }
            return;
        }
        "lexical_declaration" | "variable_declaration" => {
            // Detect `const foo = () => {}` and `const foo = function() {}`
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "variable_declarator" {
                    let name_node = child.child_by_field_name("name");
                    let value_node = child.child_by_field_name("value");
                    if let (Some(name_n), Some(val)) = (name_node, value_node) {
                        if matches!(
                            val.kind(),
                            "arrow_function" | "function_expression" | "generator_function"
                        ) {
                            let name = node_text(name_n, source).to_string();
                            let kind = if parent.is_some() {
                                SymbolKind::Method
                            } else {
                                SymbolKind::Function
                            };
                            push_symbol(symbols, name, kind, child, source, parent, true);
                        }
                    }
                }
            }
            return;
        }
        "class_declaration" | "abstract_class_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(
                    symbols,
                    name.clone(),
                    SymbolKind::Class,
                    node,
                    source,
                    parent,
                    false,
                );
                // Recurse into class body so methods are captured.
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    walk_js(child, source, Some(&name), symbols);
                }
            }
            return;
        }
        "method_definition" | "public_field_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                // Skip constructors and private-ish names
                if name != "constructor" {
                    push_symbol(
                        symbols,
                        name,
                        SymbolKind::Method,
                        node,
                        source,
                        parent,
                        true,
                    );
                }
            }
            return;
        }
        // TypeScript-specific
        "interface_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Interface, node, source, parent, false);
            }
            return;
        }
        "type_alias_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::TypeAlias, node, source, parent, true);
            }
            return;
        }
        "enum_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Enum, node, source, parent, false);
            }
            return;
        }
        "export_statement" => {
            // Transparently recurse into export so inner decls are captured.
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                walk_js(child, source, parent, symbols);
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_js(child, source, parent, symbols);
    }
}

// ─── Python walker ───────────────────────────────────────────────────────────

fn walk_python(node: Node, source: &[u8], parent: Option<&str>, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_definition" | "async_function_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let kind = if parent.is_some() {
                    SymbolKind::Method
                } else {
                    SymbolKind::Function
                };
                push_symbol(symbols, name, kind, node, source, parent, true);
            }
            return;
        }
        "decorated_definition" => {
            // `@decorator\ndef foo(): ...` — recurse into the inner definition only.
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                match child.kind() {
                    "function_definition"
                    | "async_function_definition"
                    | "class_definition" => walk_python(child, source, parent, symbols),
                    _ => {}
                }
            }
            return;
        }
        "class_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(
                    symbols,
                    name.clone(),
                    SymbolKind::Class,
                    node,
                    source,
                    parent,
                    false,
                );
                // Recurse into class body.
                if let Some(body) = node.child_by_field_name("body") {
                    let mut cursor = body.walk();
                    for child in body.children(&mut cursor) {
                        walk_python(child, source, Some(&name), symbols);
                    }
                }
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_python(child, source, parent, symbols);
    }
}

// ─── Go walker ───────────────────────────────────────────────────────────────

fn walk_go(node: Node, source: &[u8], parent: Option<&str>, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Function, node, source, parent, true);
            }
            return;
        }
        "method_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                // Extract the receiver type for the parent field.
                let receiver_type = go_receiver_type(node, source);
                push_symbol(
                    symbols,
                    name,
                    SymbolKind::Method,
                    node,
                    source,
                    receiver_type.as_deref().or(parent),
                    true,
                );
            }
            return;
        }
        "type_declaration" => {
            // Contains one or more type_spec children.
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "type_spec" {
                    let name = child
                        .child_by_field_name("name")
                        .map(|n| node_text(n, source).to_string());
                    let type_node = child.child_by_field_name("type");
                    if let (Some(name), Some(type_n)) = (name, type_node) {
                        let kind = match type_n.kind() {
                            "struct_type" => SymbolKind::Struct,
                            "interface_type" => SymbolKind::Interface,
                            _ => SymbolKind::TypeAlias,
                        };
                        push_symbol(symbols, name, kind, child, source, parent, false);
                    }
                }
            }
            return;
        }
        "const_declaration" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "const_spec" {
                    // name field may be an identifier_list
                    if let Some(name_node) = child.child_by_field_name("name") {
                        let name = node_text(name_node, source).to_string();
                        push_symbol(
                            symbols,
                            name,
                            SymbolKind::Constant,
                            child,
                            source,
                            parent,
                            false,
                        );
                    }
                }
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_go(child, source, parent, symbols);
    }
}

/// Extract the receiver type name from a Go method declaration.
fn go_receiver_type(node: Node, source: &[u8]) -> Option<String> {
    let receiver = node.child_by_field_name("receiver")?;
    // receiver is a parameter_list, find the first parameter_declaration inside
    let mut cursor = receiver.walk();
    for child in receiver.children(&mut cursor) {
        if child.kind() == "parameter_declaration" {
            if let Some(type_node) = child.child_by_field_name("type") {
                let raw = node_text(type_node, source).trim_start_matches('*').to_string();
                return Some(raw);
            }
        }
    }
    None
}

// ─── C walker ────────────────────────────────────────────────────────────────

fn walk_c(node: Node, source: &[u8], parent: Option<&str>, symbols: &mut Vec<Symbol>) {
    match node.kind() {
        "function_definition" => {
            if let Some(declarator) = node.child_by_field_name("declarator") {
                if let Some(name) = c_function_name(declarator, source) {
                    push_symbol(symbols, name, SymbolKind::Function, node, source, parent, true);
                }
            }
            return;
        }
        "struct_specifier" | "union_specifier" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Struct, node, source, parent, false);
            }
            return;
        }
        "enum_specifier" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                push_symbol(symbols, name, SymbolKind::Enum, node, source, parent, false);
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_c(child, source, parent, symbols);
    }
}

/// Recursively descend through function_declarator / pointer_declarator to find the identifier.
fn c_function_name(node: Node, source: &[u8]) -> Option<String> {
    match node.kind() {
        "function_declarator" | "pointer_declarator" | "abstract_function_declarator" => {
            let inner = node.child_by_field_name("declarator")?;
            c_function_name(inner, source)
        }
        "identifier" => Some(node_text(node, source).to_string()),
        _ => None,
    }
}

// ─── Bash walker ─────────────────────────────────────────────────────────────

fn walk_bash(node: Node, source: &[u8], parent: Option<&str>, symbols: &mut Vec<Symbol>) {
    if node.kind() == "function_definition" {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = node_text(name_node, source).to_string();
            push_symbol(symbols, name, SymbolKind::Function, node, source, parent, true);
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_bash(child, source, parent, symbols);
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn p(name: &str) -> PathBuf {
        PathBuf::from(name)
    }

    // ── detect_language ──────────────────────────────────────────────────────

    #[test]
    fn test_detect_language_rust() {
        assert_eq!(detect_language(&p("foo.rs")), Some(SupportedLanguage::Rust));
    }

    #[test]
    fn test_detect_language_ts() {
        assert_eq!(
            detect_language(&p("foo.ts")),
            Some(SupportedLanguage::TypeScript)
        );
        assert_eq!(detect_language(&p("foo.tsx")), Some(SupportedLanguage::TSX));
    }

    #[test]
    fn test_detect_language_js() {
        assert_eq!(
            detect_language(&p("foo.js")),
            Some(SupportedLanguage::JavaScript)
        );
        assert_eq!(
            detect_language(&p("foo.mjs")),
            Some(SupportedLanguage::JavaScript)
        );
        assert_eq!(detect_language(&p("foo.jsx")), Some(SupportedLanguage::JSX));
    }

    #[test]
    fn test_detect_language_python() {
        assert_eq!(
            detect_language(&p("foo.py")),
            Some(SupportedLanguage::Python)
        );
        assert_eq!(
            detect_language(&p("foo.pyw")),
            Some(SupportedLanguage::Python)
        );
    }

    #[test]
    fn test_detect_language_go() {
        assert_eq!(detect_language(&p("foo.go")), Some(SupportedLanguage::Go));
    }

    #[test]
    fn test_detect_language_c() {
        assert_eq!(detect_language(&p("foo.c")), Some(SupportedLanguage::C));
        assert_eq!(detect_language(&p("foo.h")), Some(SupportedLanguage::C));
    }

    #[test]
    fn test_detect_language_bash() {
        assert_eq!(detect_language(&p("foo.sh")), Some(SupportedLanguage::Bash));
        assert_eq!(
            detect_language(&p("foo.bash")),
            Some(SupportedLanguage::Bash)
        );
    }

    #[test]
    fn test_detect_language_unsupported() {
        assert_eq!(detect_language(&p("foo.sql")), None);
        assert_eq!(detect_language(&p("foo.md")), None);
        assert_eq!(detect_language(&p("Makefile")), None);
    }

    // ── Rust symbols ─────────────────────────────────────────────────────────

    #[test]
    fn test_parse_rust_functions() {
        let src = r#"
fn standalone() {}
pub fn public_fn(x: i32) -> i32 { x }
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Rust);
        let names: Vec<_> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"standalone"), "expected standalone fn");
        assert!(names.contains(&"public_fn"), "expected public_fn");
        for s in &symbols {
            assert_eq!(s.kind, SymbolKind::Function);
            assert!(s.parent.is_none());
        }
    }

    #[test]
    fn test_parse_rust_struct_enum_trait() {
        let src = r#"
struct MyStruct { x: i32 }
enum MyEnum { A, B }
trait MyTrait { fn foo(&self); }
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Rust);
        let find = |name: &str| symbols.iter().any(|s| s.name == name);
        assert!(find("MyStruct"), "expected MyStruct");
        assert!(find("MyEnum"), "expected MyEnum");
        assert!(find("MyTrait"), "expected MyTrait");
    }

    #[test]
    fn test_parse_rust_impl_methods() {
        let src = r#"
struct Foo;
impl Foo {
    pub fn new() -> Self { Foo }
    fn helper(&self) {}
}
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Rust);
        let methods: Vec<_> = symbols
            .iter()
            .filter(|s| s.kind == SymbolKind::Method)
            .collect();
        assert!(!methods.is_empty(), "expected methods from impl block");
        for m in &methods {
            assert_eq!(m.parent.as_deref(), Some("Foo"), "method parent should be Foo");
        }
        let method_names: Vec<_> = methods.iter().map(|s| s.name.as_str()).collect();
        assert!(method_names.contains(&"new"));
        assert!(method_names.contains(&"helper"));
    }

    #[test]
    fn test_parse_rust_const_type_alias() {
        let src = r#"
const MAX: usize = 100;
type MyResult = Result<(), String>;
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Rust);
        let find = |name: &str, kind: &SymbolKind| {
            symbols.iter().any(|s| s.name == name && &s.kind == kind)
        };
        assert!(find("MAX", &SymbolKind::Constant));
        assert!(find("MyResult", &SymbolKind::TypeAlias));
    }

    #[test]
    fn test_parse_rust_nested_symbols_have_parent() {
        let src = r#"
trait Greet {
    fn hello(&self);
    fn goodbye(&self) {}
}
impl Greet for String {
    fn hello(&self) { println!("hello"); }
}
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Rust);
        let in_trait: Vec<_> = symbols
            .iter()
            .filter(|s| s.parent.as_deref() == Some("Greet"))
            .collect();
        assert!(!in_trait.is_empty(), "methods in trait should have parent");

        let in_impl: Vec<_> = symbols
            .iter()
            .filter(|s| s.parent.as_deref() == Some("String"))
            .collect();
        assert!(!in_impl.is_empty(), "methods in impl should have parent");
    }

    #[test]
    fn test_parse_rust_line_ranges() {
        let src = "fn small() {}\nfn multi(\n    x: i32,\n    y: i32,\n) {}\n";
        let symbols = extract_symbols(src, &SupportedLanguage::Rust);
        let small = symbols.iter().find(|s| s.name == "small").unwrap();
        assert_eq!(small.line, 1);
        assert_eq!(small.line_end, 1);

        let multi = symbols.iter().find(|s| s.name == "multi").unwrap();
        assert_eq!(multi.line, 2);
        assert!(multi.line_end >= 5, "multi should span multiple lines");
    }

    // ── TypeScript symbols ────────────────────────────────────────────────────

    #[test]
    fn test_parse_typescript_functions_and_classes() {
        let src = r#"
function greet(name: string): string { return "hi"; }
const add = (a: number, b: number) => a + b;
class Calculator {
    multiply(x: number, y: number): number { return x * y; }
}
interface Printable { print(): void; }
type ID = string | number;
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::TypeScript);
        let find = |name: &str| symbols.iter().any(|s| s.name == name);
        assert!(find("greet"), "expected greet");
        assert!(find("add"), "expected arrow fn add");
        assert!(find("Calculator"), "expected Calculator class");
        assert!(find("multiply"), "expected multiply method");
        assert!(find("Printable"), "expected Printable interface");
        assert!(find("ID"), "expected ID type alias");

        let multiply = symbols.iter().find(|s| s.name == "multiply").unwrap();
        assert_eq!(multiply.parent.as_deref(), Some("Calculator"));
    }

    #[test]
    fn test_parse_typescript_enum() {
        let src = "enum Direction { Up, Down, Left, Right }";
        let symbols = extract_symbols(src, &SupportedLanguage::TypeScript);
        assert!(symbols.iter().any(|s| s.name == "Direction" && s.kind == SymbolKind::Enum));
    }

    #[test]
    fn test_parse_typescript_export_transparent() {
        let src = "export function hello() {} export class World {}";
        let symbols = extract_symbols(src, &SupportedLanguage::TypeScript);
        assert!(symbols.iter().any(|s| s.name == "hello"));
        assert!(symbols.iter().any(|s| s.name == "World"));
    }

    // ── Python symbols ────────────────────────────────────────────────────────

    #[test]
    fn test_parse_python_functions_and_classes() {
        let src = r#"
def standalone():
    pass

class Animal:
    def speak(self):
        pass

@property
def computed():
    return 42
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Python);
        let find = |name: &str| symbols.iter().any(|s| s.name == name);
        assert!(find("standalone"));
        assert!(find("Animal"));
        assert!(find("speak"));
        assert!(find("computed"), "decorated function should be extracted");

        let speak = symbols.iter().find(|s| s.name == "speak").unwrap();
        assert_eq!(speak.parent.as_deref(), Some("Animal"));
        assert_eq!(speak.kind, SymbolKind::Method);
    }

    // ── Go symbols ────────────────────────────────────────────────────────────

    #[test]
    fn test_parse_go_functions_and_types() {
        let src = r#"
package main

func main() {}

type Server struct {
    host string
}

func (s *Server) Start() error {
    return nil
}

type Handler interface {
    Handle(req string) string
}
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Go);
        let find = |name: &str| symbols.iter().any(|s| s.name == name);
        assert!(find("main"));
        assert!(find("Server"));
        assert!(find("Start"));
        assert!(find("Handler"));

        let start = symbols.iter().find(|s| s.name == "Start").unwrap();
        assert_eq!(start.kind, SymbolKind::Method);
        assert_eq!(start.parent.as_deref(), Some("Server"));

        let handler = symbols.iter().find(|s| s.name == "Handler").unwrap();
        assert_eq!(handler.kind, SymbolKind::Interface);
    }

    // ── C symbols ─────────────────────────────────────────────────────────────

    #[test]
    fn test_parse_c_functions_and_structs() {
        let src = r#"
#include <stdio.h>

struct Point { int x; int y; };

int add(int a, int b) {
    return a + b;
}

void greet(const char *name) {
    printf("Hello, %s\n", name);
}
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::C);
        let find = |name: &str| symbols.iter().any(|s| s.name == name);
        assert!(find("Point"), "expected Point struct");
        assert!(find("add"), "expected add function");
        assert!(find("greet"), "expected greet function");
    }

    // ── Bash symbols ──────────────────────────────────────────────────────────

    #[test]
    fn test_parse_bash_functions() {
        let src = r#"
#!/bin/bash
function setup_env() {
    export PATH="$PATH:/usr/local/bin"
}

deploy() {
    echo "deploying..."
}
"#;
        let symbols = extract_symbols(src, &SupportedLanguage::Bash);
        let find = |name: &str| symbols.iter().any(|s| s.name == name);
        assert!(find("setup_env"), "expected setup_env");
        assert!(find("deploy"), "expected deploy");
    }

    // ── Edge cases ────────────────────────────────────────────────────────────

    #[test]
    fn test_unsupported_extension_returns_empty() {
        // detect_language returns None, so extract_symbols is never called
        // But even if called directly with empty walker, should not crash.
        let path = PathBuf::from("query.sql");
        assert!(detect_language(&path).is_none());
    }

    #[test]
    fn test_malformed_code_does_not_panic() {
        // tree-sitter is designed to handle errors gracefully.
        let src = "fn broken( { let x = ;; struct ??? }";
        let symbols = extract_symbols(src, &SupportedLanguage::Rust);
        // May or may not extract anything, but must not panic.
        let _ = symbols;
    }

    #[test]
    fn test_empty_file_returns_empty() {
        let symbols = extract_symbols("", &SupportedLanguage::Rust);
        assert!(symbols.is_empty());
    }

    // ── summarize_file ────────────────────────────────────────────────────────

    #[test]
    fn test_summarize_file_rust() {
        let src = "fn foo() {}\nfn bar() {}\nstruct Baz {}\n";
        let path = PathBuf::from("main.rs");
        let summary = summarize_file(&path, src).unwrap();
        assert_eq!(summary.language, "rust");
        assert_eq!(summary.symbol_count, 3);
        assert!(summary.top_level_names.contains(&"foo".to_string()));
        assert!(summary.top_level_names.contains(&"bar".to_string()));
        assert!(summary.top_level_names.contains(&"Baz".to_string()));
    }

    #[test]
    fn test_summarize_file_unsupported_returns_none() {
        let path = PathBuf::from("schema.sql");
        assert!(summarize_file(&path, "SELECT 1;").is_none());
    }

    #[test]
    fn test_summarize_file_methods_excluded_from_top_level() {
        let src = "struct Foo;\nimpl Foo { fn bar(&self) {} fn baz(&self) {} }\n";
        let path = PathBuf::from("foo.rs");
        let summary = summarize_file(&path, src).unwrap();
        // Struct is top-level; methods have a parent so are excluded.
        assert!(
            summary.top_level_names.contains(&"Foo".to_string()),
            "Foo struct should be top-level"
        );
        assert!(
            !summary.top_level_names.contains(&"bar".to_string()),
            "bar method should not be top-level"
        );
    }
}
