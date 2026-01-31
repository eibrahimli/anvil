import { GitStatusCard } from './GitStatusCard';
import { FileReadCard } from './FileReadCard';
import { BashResultCard } from './BashResultCard';
import { WriteFileCard } from './WriteFileCard';
import { SearchCard } from './SearchCard';
import { EditFileCard } from './EditFileCard';
import { SymbolCard } from './SymbolCard';
import { GenericToolCard } from './GenericToolCard';

interface ToolResultRendererProps {
  toolName: string;
  result: string;
}

export function ToolResultRenderer({ toolName, result }: ToolResultRendererProps) {
  // Try to parse the result as JSON
  let parsedResult: unknown;
  try {
    parsedResult = JSON.parse(result);
  } catch {
    // If not valid JSON, treat as plain text
    parsedResult = { content: result };
  }

  // Route to appropriate component based on tool name
  switch (toolName) {
    case 'git': {
      // Check if this is a git status result
      const data = parsedResult as {
        branch?: string;
        staged?: string[];
        unstaged?: string[];
        untracked?: string[];
        conflicted?: string[];
        latest_commit?: string;
      };

      if (data.branch !== undefined) {
        return (
          <GitStatusCard
            data={{
              branch: data.branch,
              staged: data.staged || [],
              unstaged: data.unstaged || [],
              untracked: data.untracked || [],
              conflicted: data.conflicted || [],
              latest_commit: data.latest_commit,
            }}
          />
        );
      }

      // Git log, commit, add results
      return (
        <GenericToolCard
          toolName={toolName}
          data={parsedResult as Record<string, unknown>}
        />
      );
    }

    case 'read_file': {
      const data = parsedResult as { content?: string; path?: string };
      if (data.content) {
        return <FileReadCard data={{ content: data.content, path: data.path }} />;
      }
      return (
        <GenericToolCard
          toolName={toolName}
          data={parsedResult as Record<string, unknown>}
        />
      );
    }

    case 'write_file': {
      const data = parsedResult as { status?: string; path?: string };
      return (
        <WriteFileCard
          data={{
            status: data.status || 'unknown',
            path: data.path,
          }}
        />
      );
    }

    case 'edit_file': {
      const data = parsedResult as { status?: string; message?: string; path?: string };
      return (
        <EditFileCard
          data={{
            status: data.status || 'unknown',
            message: data.message,
            path: data.path,
          }}
        />
      );
    }

    case 'bash': {
      const data = parsedResult as {
        stdout?: string;
        stderr?: string;
        exit_code?: number;
        command?: string;
      };
      return (
        <BashResultCard
          data={{
            stdout: data.stdout || '',
            stderr: data.stderr,
            exit_code: data.exit_code,
            command: data.command,
          }}
        />
      );
    }

    case 'search': {
      const data = parsedResult as { matches?: any[]; count?: number };
      return (
        <SearchCard
          data={{
            matches: data.matches || [],
            count: data.count || 0,
          }}
        />
      );
    }

    case 'list_symbols': {
      const data = parsedResult as { symbols?: any[]; count?: number; path?: string };
      return (
        <SymbolCard
          data={{
            symbols: data.symbols || [],
            count: data.count || 0,
            path: data.path || '',
          }}
        />
      );
    }

    default: {
      // For unknown tools, render generic card
      return (
        <GenericToolCard
          toolName={toolName}
          data={parsedResult as Record<string, unknown>}
        />
      );
    }
  }
}
