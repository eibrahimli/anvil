import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { Plus, RefreshCw, Server, Play, Power, Trash2, X, ChevronDown } from "lucide-react";
import clsx from "clsx";

interface McpServer {
  name: string;
  transport_type: "stdio" | "http";
  enabled: boolean;
  command?: string[];
  url?: string;
  env?: Record<string, string>;
}

interface McpConfigResponse {
  enabled: boolean;
  server_count: number;
  servers: McpServer[];
}

export function McpManager() {
  const { workspacePath } = useStore();
  const [config, setConfig] = useState<McpConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, "connected" | "disconnected" | "connecting" | "error">>({});
  const [showAddModal, setShowAddModal] = useState(false);

  const loadConfig = async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const res = await invoke<McpConfigResponse>("load_mcp_config", { workspacePath });
      setConfig(res);
    } catch (e) {
      console.error("Failed to load MCP config:", e);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async (newConfig: McpConfigResponse) => {
    if (!workspacePath) return;
    try {
      // Transform array back to object for storage
      const serversObj: Record<string, any> = {};
      newConfig.servers.forEach(s => {
        serversObj[s.name] = {
          type: s.transport_type === 'stdio' ? 'local' : 'remote',
          enabled: s.enabled,
          command: s.command,
          url: s.url,
          environment: s.env
        };
      });

      const configToSave = {
        enabled: newConfig.enabled,
        servers: serversObj
      };

      await invoke("save_mcp_config", { 
        workspacePath,
        config: configToSave
      });
      
      setConfig(newConfig);
    } catch (e) {
      console.error("Failed to save MCP config:", e);
    }
  };

  const toggleServer = (server: McpServer) => {
    if (!config) return;
    const newServers = config.servers.map(s => 
      s.name === server.name ? { ...s, enabled: !s.enabled } : s
    );
    saveConfig({ ...config, servers: newServers });
  };

  const deleteServer = (serverName: string) => {
    if (!config || !confirm(`Delete server ${serverName}?`)) return;
    const newServers = config.servers.filter(s => s.name !== serverName);
    saveConfig({ ...config, servers: newServers });
  };

  useEffect(() => {
    loadConfig();
  }, [workspacePath]);

  const testServerConnection = async (server: McpServer) => {
    setConnectionStatus(prev => ({ ...prev, [server.name]: "connecting" }));
    try {
      await invoke("test_mcp_connection", {
        transportType: server.transport_type,
        command: server.command,
        url: server.url,
        env: server.env
      });
      setConnectionStatus(prev => ({ ...prev, [server.name]: "connected" }));
    } catch (e) {
      console.error(`Failed to connect to ${server.name}:`, e);
      setConnectionStatus(prev => ({ ...prev, [server.name]: "error" }));
    }
  };

  if (!config) return <div className="p-4 text-zinc-400">Loading configuration...</div>;

  return (
    <div className="p-4 text-white h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Server size={20} className="text-purple-400" />
          MCP Servers
        </h2>
        <button 
          onClick={loadConfig}
          className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
          title="Refresh Config"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="space-y-4 flex-1 overflow-auto">
        {config.servers.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-zinc-700 rounded-lg text-zinc-500">
            <p>No MCP servers configured.</p>
            <p className="text-xs mt-2">Edit .anvil/anvil.json to add servers.</p>
          </div>
        ) : (
          config.servers.map((server) => (
            <div key={server.name} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={clsx(
                    "w-2 h-2 rounded-full",
                    server.enabled ? "bg-green-500" : "bg-zinc-600"
                  )} />
                  <span className="font-semibold">{server.name}</span>
                  <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400 uppercase">
                    {server.transport_type}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={() => testServerConnection(server)}
                    className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white"
                    title="Test Connection"
                  >
                    <Play size={14} />
                  </button>
                  <button 
                    onClick={() => toggleServer(server)}
                    className={clsx(
                      "p-1.5 hover:bg-zinc-800 rounded",
                      server.enabled ? "text-green-400 hover:text-green-300" : "text-zinc-500 hover:text-zinc-400"
                    )}
                    title={server.enabled ? "Disable" : "Enable"}
                  >
                    <Power size={14} />
                  </button>
                  <button 
                    onClick={() => deleteServer(server.name)}
                    className="p-1.5 hover:bg-zinc-800 rounded text-zinc-500 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="text-xs text-zinc-400 font-mono bg-zinc-950/50 p-2 rounded mb-3 overflow-x-auto">
                {server.transport_type === 'stdio' ? (
                  <div className="flex gap-2">
                    <span className="text-purple-400">$</span>
                    <span>{server.command?.join(' ')}</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <span className="text-blue-400">URL:</span>
                    <span>{server.url}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span>Status:</span>
                  <span className={clsx(
                    "font-medium",
                    connectionStatus[server.name] === 'connected' ? "text-green-400" :
                    connectionStatus[server.name] === 'error' ? "text-red-400" :
                    connectionStatus[server.name] === 'connecting' ? "text-yellow-400" :
                    "text-zinc-500"
                  )}>
                    {connectionStatus[server.name] === 'connected' ? 'Online' :
                     connectionStatus[server.name] === 'error' ? 'Failed' :
                     connectionStatus[server.name] === 'connecting' ? 'Connecting...' :
                     'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-zinc-800">
        <button 
          onClick={() => setShowAddModal(true)}
          className="w-full flex items-center justify-center gap-2 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          Add Server
        </button>
      </div>

      {showAddModal && (
        <AddServerModal 
          onClose={() => setShowAddModal(false)} 
          onSave={(server) => {
            if (config) {
              saveConfig({ ...config, servers: [...config.servers, server] });
              setShowAddModal(false);
            }
          }} 
        />
      )}
    </div>
  );
}

function AddServerModal({ onClose, onSave }: { onClose: () => void, onSave: (server: McpServer) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      transport_type: type,
      enabled: true,
      command: type === 'stdio' ? command.split(' ') : undefined,
      url: type === 'http' ? url : undefined,
      env: {}
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-96 max-w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">Add MCP Server</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Name</label>
            <input 
              type="text" 
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. github"
              className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Transport</label>
            <div className="relative">
              <select 
                value={type}
                onChange={e => setType(e.target.value as any)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded pl-2 pr-8 py-2 text-white appearance-none outline-none focus:border-purple-500"
                style={{ backgroundColor: '#27272a', color: 'white' }}
              >
                <option value="stdio" style={{ backgroundColor: '#27272a', color: 'white' }}>Stdio (Local)</option>
                <option value="http" style={{ backgroundColor: '#27272a', color: 'white' }}>HTTP (Remote)</option>
              </select>
              <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>
          </div>
          
          {type === 'stdio' ? (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Command</label>
              <input 
                type="text" 
                required
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-git"
                className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white font-mono text-xs"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">URL</label>
              <input 
                type="url" 
                required
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-white"
              />
            </div>
          )}
          
          <div className="flex justify-end gap-2 mt-6">
            <button 
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 text-sm"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-white text-sm font-medium"
            >
              Add Server
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
