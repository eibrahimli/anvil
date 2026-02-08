import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Layers, RefreshCw, ChevronRight, ChevronDown, Terminal, Plus, Save, X, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { useUIStore } from '../stores/ui';
import { ConfirmDialog } from './common/ConfirmDialog';

interface WorkflowSummary {
  id: string;
  name: string;
  description?: string | null;
  version?: number;
  created_at?: string;
  updated_at?: string;
  steps?: number;
}

interface WorkflowStep {
  id: string;
  title: string;
  command: string;
  description?: string | null;
  requires_approval?: boolean | null;
  working_dir?: string | null;
}

interface WorkflowDetail {
  id: string;
  name: string;
  description?: string | null;
  steps: WorkflowStep[];
  version?: number;
  created_at?: string;
  updated_at?: string;
}

interface WorkflowDraft {
  id: string;
  name: string;
  description?: string | null;
  steps: WorkflowStep[];
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export function WorkflowsPanel() {
  const { workspacePath } = useStore();
  const { isTerminalOpen, toggleTerminal } = useUIStore();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; id: string | null; name: string | null }>(
    { show: false, id: null, name: null }
  );
  const [runState, setRunState] = useState<{ workflowId: string; index: number; steps: WorkflowStep[]; commands: string[] } | null>(null);
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [runParamValues, setRunParamValues] = useState<Record<string, Record<string, string>>>({});
  const [paramPromptOpen, setParamPromptOpen] = useState(false);
  const [paramPromptWorkflow, setParamPromptWorkflow] = useState<WorkflowDetail | null>(null);

  const extractParamKeys = (steps: WorkflowStep[]) => {
    const keys = new Set<string>();
    const pattern = /\{\{([a-zA-Z0-9_-]+)\}\}/g;
    steps.forEach((step) => {
      let match = pattern.exec(step.command);
      while (match) {
        keys.add(match[1]);
        match = pattern.exec(step.command);
      }
    });
    return Array.from(keys).sort();
  };

  const draftParamKeys = draft ? extractParamKeys(draft.steps) : [];

  useEffect(() => {
    if (!draft) return;
    setParamValues((prev) => {
      const next: Record<string, string> = {};
      draftParamKeys.forEach((key) => {
        next[key] = prev[key] ?? '';
      });
      return next;
    });
  }, [draft?.id, draft?.steps.length, draftParamKeys.join('|')]);

  useEffect(() => {
    if (!workspacePath) return;
    loadWorkflows();
  }, [workspacePath]);

  const loadWorkflows = async () => {
    if (!workspacePath) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await invoke<{ workflows: WorkflowSummary[]; count: number }>('list_workflows', {
        workspacePath
      });
      setWorkflows(result.workflows || []);
      if (result.workflows.length === 0) {
        setExpandedId(null);
        setWorkflowDetail(null);
      }
    } catch (error) {
      console.error('Failed to load workflows:', error);
      setErrorMessage('Failed to load workflows.');
    } finally {
      setLoading(false);
    }
  };

  const createId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const startNewWorkflow = () => {
    const now = new Date().toISOString();
    setDraft({
      id: createId(),
      name: '',
      description: '',
      steps: [
        {
          id: createId(),
          title: 'Step 1',
          command: '',
          description: '',
          requires_approval: true,
          working_dir: ''
        }
      ],
      version: 1,
      created_at: now,
      updated_at: now
    });
    setFormError(null);
    setEditing(true);
  };

  const startEditWorkflow = async (id: string) => {
    if (!workspacePath) return;
    setFormError(null);
    setEditing(true);
    setDraft(null);
    try {
      const detail = await invoke<WorkflowDetail>('load_workflow', {
        workspacePath,
        workflowId: id
      });
      setDraft(detail);
    } catch (error) {
      console.error('Failed to load workflow for edit:', error);
      setFormError('Failed to load workflow for edit.');
      setEditing(false);
    }
  };

  const updateDraft = (next: Partial<WorkflowDraft>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, ...next };
    });
  };

  const updateStep = (index: number, next: Partial<WorkflowStep>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const steps = prev.steps.map((step, idx) => idx === index ? { ...step, ...next } : step);
      return { ...prev, steps };
    });
  };

  const resolveCommand = (command: string, values: Record<string, string>) => {
    return command.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, key) => {
      const value = values[key];
      return value && value.trim() ? value : `<${key}>`;
    });
  };

  const buildRunCommand = (step: WorkflowStep, values: Record<string, string>) => {
    const resolved = resolveCommand(step.command, values);
    if (!step.working_dir || !step.working_dir.trim()) {
      return resolved;
    }
    const rawDir = step.working_dir.trim();
    const basePath = workspacePath?.replace(/\/$/, '');
    const isAbsolute = rawDir.startsWith('/') || /^[A-Za-z]:\\/.test(rawDir);
    const dir = isAbsolute || !basePath ? rawDir : `${basePath}/${rawDir}`;
    return `cd "${dir.replace(/"/g, '\\"')}" && ${resolved}`;
  };

  const getMissingParams = (keys: string[], values: Record<string, string>) => {
    return keys.filter((key) => !values[key] || !values[key].trim());
  };

  const promptForParamsIfNeeded = (workflow: WorkflowDetail) => {
    const keys = extractParamKeys(workflow.steps);
    if (keys.length === 0) return false;
    const values = runParamValues[workflow.id] || {};
    const missing = getMissingParams(keys, values);
    if (missing.length === 0) return false;
    setParamPromptWorkflow(workflow);
    setParamPromptOpen(true);
    return true;
  };

  const ensureTerminalReady = async () => {
    if (!workspacePath) {
      setErrorMessage('Select a workspace to run workflows.');
      return false;
    }
    if (!isTerminalOpen) {
      toggleTerminal();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await invoke('spawn_terminal', { workspacePath }).catch(console.error);
    return true;
  };

  const runAutoSteps = async (state: { workflowId: string; index: number; steps: WorkflowStep[]; commands: string[] }) => {
    const ready = await ensureTerminalReady();
    if (!ready) return;
    let index = state.index;
    while (index < state.steps.length) {
      const step = state.steps[index];
      const requiresApproval = step.requires_approval !== false;
      if (requiresApproval) {
        setRunState({ ...state, index });
        setRunConfirmOpen(true);
        return;
      }
      await invoke('write_terminal', { data: `${state.commands[index]}\n` }).catch(console.error);
      index += 1;
    }
    setRunState(null);
  };

  const runWorkflow = async (workflow: WorkflowDetail) => {
    if (promptForParamsIfNeeded(workflow)) return;
    const values = runParamValues[workflow.id] || {};
    const commands = workflow.steps.map((step) => buildRunCommand(step, values));
    const nextState = { workflowId: workflow.id, index: 0, steps: workflow.steps, commands };
    await runAutoSteps(nextState);
  };

  const handleConfirmRunStep = async () => {
    if (!runState) return;
    const workflow = paramPromptWorkflow?.id === runState.workflowId ? paramPromptWorkflow : null;
    if (workflow && promptForParamsIfNeeded(workflow)) return;
    const ready = await ensureTerminalReady();
    if (!ready) return;
    const command = runState.commands[runState.index];
    await invoke('write_terminal', { data: `${command}\n` }).catch(console.error);
    const nextIndex = runState.index + 1;
    const nextState = { ...runState, index: nextIndex };
    setRunConfirmOpen(false);
    await runAutoSteps(nextState);
  };

  const handleCancelRun = () => {
    setRunConfirmOpen(false);
    setRunState(null);
  };

  const handleConfirmParams = () => {
    if (!paramPromptWorkflow) return;
    setParamPromptOpen(false);
    runWorkflow(paramPromptWorkflow);
  };

  const handleCancelParams = () => {
    setParamPromptOpen(false);
    setParamPromptWorkflow(null);
  };

  const addStep = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextIndex = prev.steps.length + 1;
      return {
        ...prev,
        steps: [
          ...prev.steps,
          {
            id: createId(),
            title: `Step ${nextIndex}`,
            command: '',
            description: '',
            requires_approval: true,
            working_dir: ''
          }
        ]
      };
    });
  };

  const removeStep = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const steps = prev.steps.filter((_, idx) => idx !== index);
      return { ...prev, steps };
    });
  };

  const validateDraft = (value: WorkflowDraft) => {
    if (!value.name.trim()) return 'Workflow name is required.';
    if (value.steps.length === 0) return 'Add at least one step.';
    for (const step of value.steps) {
      if (!step.command.trim()) return 'Each step needs a command.';
    }
    return null;
  };

  const handleSave = async () => {
    if (!workspacePath || !draft) return;
    const error = validateDraft(draft);
    if (error) {
      setFormError(error);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await invoke<WorkflowDetail>('save_workflow', {
        workspacePath,
        workflow: draft
      });
      setEditing(false);
      setDraft(null);
      await loadWorkflows();
    } catch (error) {
      console.error('Failed to save workflow:', error);
      setFormError('Failed to save workflow.');
    } finally {
      setSaving(false);
    }
  };

  const handleAskDelete = (workflowId: string, workflowName: string | null) => {
    setDeleteConfirm({ show: true, id: workflowId, name: workflowName });
  };

  const handleCancelDelete = () => {
    setDeleteConfirm({ show: false, id: null, name: null });
  };

  const handleDelete = async () => {
    if (!workspacePath) return;
    if (!deleteConfirm.id) return;
    const workflowId = deleteConfirm.id;
    setDeletingId(workflowId);
    setErrorMessage(null);
    try {
      await invoke('delete_workflow', {
        workspacePath,
        workflowId
      });
      if (expandedId === workflowId) {
        setExpandedId(null);
        setWorkflowDetail(null);
      }
      if (draft?.id === workflowId) {
        handleCancel();
      }
      await loadWorkflows();
      setDeleteConfirm({ show: false, id: null, name: null });
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      setErrorMessage('Failed to delete workflow.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft(null);
    setFormError(null);
  };

  const loadDetail = async (id: string) => {
    if (!workspacePath) return;
    setDetailLoading(true);
    setErrorMessage(null);
    try {
      const detail = await invoke<WorkflowDetail>('load_workflow', {
        workspacePath,
        workflowId: id
      });
      setWorkflowDetail(detail);
    } catch (error) {
      console.error('Failed to load workflow:', error);
      setErrorMessage('Failed to load workflow detail.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleToggle = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setWorkflowDetail(null);
      return;
    }
    setExpandedId(id);
    loadDetail(id);
  };

  if (!workspacePath) {
    return (
      <div className="p-4 text-sm text-zinc-500 text-center">
        Select a workspace to view workflows
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-3 h-3" />
            Workflows ({workflows.length})
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={startNewWorkflow}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              title="New workflow"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={loadWorkflows}
              disabled={loading}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Refresh workflows"
            >
              <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="text-xs text-red-400">{errorMessage}</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {editing && draft && (
          <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-zinc-200 uppercase tracking-wider">Workflow Editor</div>
              <button
                onClick={handleCancel}
                className="text-zinc-400 hover:text-zinc-200"
                title="Close editor"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-2">
              <input
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder="Workflow name"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
              />
              <textarea
                value={draft.description || ''}
                onChange={(e) => updateDraft({ description: e.target.value })}
                placeholder="Description (optional)"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-xs text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                rows={2}
              />
            </div>

            {draftParamKeys.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Parameters</div>
                <div className="grid grid-cols-2 gap-2">
                  {draftParamKeys.map((key) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-[10px] text-zinc-500">{key}</label>
                      <input
                        value={paramValues[key] || ''}
                        onChange={(e) => setParamValues((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={`Value for ${key}`}
                        className="rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-xs text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-zinc-500">Use placeholders like {'{{param}}'} in commands.</div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Steps</div>
                <button
                  onClick={addStep}
                  className="text-[10px] uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
                >
                  Add Step
                </button>
              </div>
              <div className="space-y-2">
                {draft.steps.map((step, index) => (
                  <div key={step.id} className="rounded-md border border-zinc-800/60 bg-[#09090b] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <input
                        value={step.title}
                        onChange={(e) => updateStep(index, { title: e.target.value })}
                        placeholder={`Step ${index + 1}`}
                        className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-xs text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        onClick={() => removeStep(index)}
                        className="ml-2 text-zinc-500 hover:text-red-400 text-xs"
                        title="Remove step"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      value={step.command}
                      onChange={(e) => updateStep(index, { command: e.target.value })}
                      placeholder="Command (e.g. npm test)"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-xs font-mono font-normal text-zinc-200 focus:outline-none focus:border-[var(--accent)]"
                    />
                    {step.command.includes('{{') && (
                      <div className="text-[10px] text-zinc-500">
                        Preview: <span className="font-mono text-zinc-300">{resolveCommand(step.command, paramValues)}</span>
                      </div>
                    )}
                    <input
                      value={step.working_dir || ''}
                      onChange={(e) => updateStep(index, { working_dir: e.target.value })}
                      placeholder="Working directory (optional)"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-xs text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                    />
                    <textarea
                      value={step.description || ''}
                      onChange={(e) => updateStep(index, { description: e.target.value })}
                      placeholder="Step description (optional)"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-xs text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                      rows={2}
                    />
                    <label className="flex items-center gap-2 text-[10px] text-zinc-400 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={step.requires_approval ?? true}
                        onChange={(e) => updateStep(index, { requires_approval: e.target.checked })}
                      />
                      Require approval
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {formError && (
              <div className="text-xs text-red-400">{formError}</div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
              >
                <X size={12} />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-purple-900/20 hover:bg-[var(--accent)]/90 disabled:opacity-60"
              >
                <Save size={12} />
                {saving ? 'Saving' : 'Save'}
              </button>
            </div>
          </div>
        )}
        {loading ? (
          <div className="text-center text-xs text-zinc-500 py-4">Loading workflows...</div>
        ) : workflows.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-4">
            No workflows yet. Create one in .anvil/workflows
          </div>
        ) : (
          workflows.map((workflow) => {
            const isExpanded = expandedId === workflow.id;
            return (
              <div
                key={workflow.id}
                className={clsx(
                  "rounded-lg border transition-all",
                  isExpanded
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] bg-[var(--bg-surface)]"
                )}
              >
                <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                  <button
                    onClick={() => handleToggle(workflow.id)}
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                  >
                    <div className="text-zinc-500">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">
                        {workflow.name || workflow.id}
                      </div>
                      {workflow.description && (
                        <div className="text-xs text-zinc-500 line-clamp-1">
                          {workflow.description}
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded shrink-0">
                      {workflow.steps ?? 0} steps
                    </div>
                  </button>
                  <div className="flex items-center gap-2 sm:ml-auto shrink-0">
                    <button
                      onClick={() => startEditWorkflow(workflow.id)}
                      className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60"
                      title="Edit workflow"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleAskDelete(workflow.id, workflow.name || workflow.id)}
                      className={clsx(
                        "p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60",
                        deletingId === workflow.id && "opacity-50 cursor-wait"
                      )}
                      title="Delete workflow"
                      disabled={deletingId === workflow.id}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-[var(--border)] bg-[#0b0b10] px-3 py-2">
                    {detailLoading ? (
                      <div className="text-xs text-zinc-500 py-2">Loading details...</div>
                    ) : workflowDetail ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Steps</div>
                          <button
                            onClick={() => runWorkflow(workflowDetail)}
                            className="flex items-center gap-1.5 rounded-full bg-[var(--accent)]/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] hover:bg-[var(--accent)]/30"
                          >
                            <Terminal size={12} />
                            Run Workflow
                          </button>
                        </div>
                        {(() => {
                          const keys = extractParamKeys(workflowDetail.steps);
                          if (keys.length === 0) return null;
                          const values = runParamValues[workflowDetail.id] || {};
                          return (
                            <div className="rounded-lg border border-zinc-800/60 bg-[#0b0b10] p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Parameters</div>
                                <div className="text-[10px] text-zinc-600">Fill to resolve {'{{param}}'}</div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {keys.map((key) => (
                                  <div key={key} className="flex flex-col gap-1">
                                    <label className="text-[10px] text-zinc-500">{key}</label>
                                    <input
                                      value={values[key] || ''}
                                      onChange={(e) => setRunParamValues((prev) => ({
                                        ...prev,
                                        [workflowDetail.id]: { ...values, [key]: e.target.value }
                                      }))}
                                      placeholder={`Value for ${key}`}
                                      className="rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-xs text-zinc-100 font-normal focus:outline-none focus:border-[var(--accent)]"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        {workflowDetail.steps.length === 0 ? (
                          <div className="text-xs text-zinc-500">No steps defined.</div>
                        ) : (
                          workflowDetail.steps.map((step, index) => (
                            <div key={step.id || `${workflowDetail.id}-${index}`} className="rounded-md border border-zinc-800/60 bg-[#09090b] px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Terminal size={12} className="text-[var(--accent)]" />
                                <div className="text-xs font-semibold text-zinc-200">{step.title || `Step ${index + 1}`}</div>
                                {step.requires_approval && (
                                  <span className="text-[10px] text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">Approval</span>
                                )}
                              </div>
                              <div className="mt-1 text-[11px] font-mono text-zinc-300 break-all">{step.command}</div>
                              {step.command.includes('{{') && (
                                <div className="mt-1 text-[10px] text-zinc-500">
                                  Preview: <span className="font-mono text-zinc-300">{resolveCommand(step.command, runParamValues[workflowDetail.id] || {})}</span>
                                </div>
                              )}
                              {step.description && (
                                <div className="mt-1 text-xs text-zinc-500">{step.description}</div>
                              )}
                              {step.working_dir && (
                                <div className="mt-1 text-[10px] text-zinc-600">Dir: {step.working_dir}</div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500">Select a workflow to view details.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-[var(--border)] text-xs text-zinc-600">
        <p>Workflows stored in .anvil/workflows</p>
      </div>

      <ConfirmDialog
        open={deleteConfirm.show}
        title="Delete Workflow"
        subtitle={deleteConfirm.name || undefined}
        description="Are you sure you want to delete this workflow? This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmTone="danger"
        icon={<AlertTriangle size={20} />}
        onCancel={handleCancelDelete}
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={runConfirmOpen}
        title="Run Workflow Step"
        subtitle={runState ? `${runState.index + 1} of ${runState.steps.length}` : undefined}
        confirmLabel="Run Step"
        cancelLabel="Stop"
        confirmTone="primary"
        icon={<Terminal size={18} />}
        onCancel={handleCancelRun}
        onConfirm={handleConfirmRunStep}
        body={runState ? (
          <div className="space-y-3">
            <div className="text-xs text-zinc-400">Command to execute:</div>
            <div className="bg-[#09090b] border border-[var(--border)] rounded-lg p-3 font-mono text-xs text-green-400 break-all">
              <span className="text-zinc-500 mr-2">$</span>
              {runState.commands[runState.index]}
            </div>
            <div className="text-[10px] text-zinc-500">This step requires approval.</div>
          </div>
        ) : undefined}
      />
      <ConfirmDialog
        open={paramPromptOpen}
        title="Fill Parameters"
        subtitle={paramPromptWorkflow?.name}
        confirmLabel="Continue"
        cancelLabel="Cancel"
        confirmTone="primary"
        onCancel={handleCancelParams}
        onConfirm={handleConfirmParams}
        confirmDisabled={paramPromptWorkflow ? getMissingParams(extractParamKeys(paramPromptWorkflow.steps), runParamValues[paramPromptWorkflow.id] || {}).length > 0 : true}
        body={paramPromptWorkflow ? (
          <div className="space-y-3">
            <div className="text-xs text-zinc-400">Provide values for missing parameters.</div>
            <div className="grid grid-cols-2 gap-2">
              {extractParamKeys(paramPromptWorkflow.steps).map((key) => {
                const values = runParamValues[paramPromptWorkflow.id] || {};
                const missing = !values[key] || !values[key].trim();
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-[10px] text-zinc-500">{key}</label>
                    <input
                      value={values[key] || ''}
                      onChange={(e) => setRunParamValues((prev) => ({
                        ...prev,
                        [paramPromptWorkflow.id]: { ...values, [key]: e.target.value }
                      }))}
                      placeholder={`Value for ${key}`}
                      className={clsx(
                        "rounded-md border px-2 py-1 text-xs text-zinc-100 font-normal focus:outline-none focus:border-[var(--accent)]",
                        missing ? "border-red-500/60 bg-red-500/5" : "border-[var(--border)] bg-[var(--bg-base)]"
                      )}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : undefined}
      />
    </div>
  );
}
