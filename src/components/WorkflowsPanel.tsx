import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Layers, RefreshCw, Terminal, Plus, Save, X, Pencil, Trash2, AlertTriangle, Search, Play, RotateCcw, ArrowUp, ArrowDown, Copy } from 'lucide-react';
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

type WorkflowRunPhase = 'plan' | 'execute' | 'review';
type WorkflowRunStatus = 'planned' | 'running' | 'awaiting_approval' | 'paused' | 'completed' | 'failed' | 'cancelled';
type WorkflowRunStepStatus = 'pending' | 'waiting_approval' | 'running' | 'completed' | 'failed' | 'skipped';

interface WorkflowRunStepLog {
  id: string;
  title: string;
  command: string;
  requiresApproval: boolean;
  status: WorkflowRunStepStatus;
  message?: string;
  startedAt?: string;
  completedAt?: string;
}

interface WorkflowRunLog {
  id: string;
  workflowId: string;
  workflowName: string;
  phase: WorkflowRunPhase;
  status: WorkflowRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  params: Record<string, string>;
  steps: WorkflowRunStepLog[];
}

export function WorkflowsPanel() {
  const { workspacePath } = useStore();
  const { isTerminalOpen, toggleTerminal } = useUIStore();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; id: string | null; name: string | null }>(
    { show: false, id: null, name: null }
  );
  const [runState, setRunState] = useState<{ runId: string; workflowId: string; index: number; steps: WorkflowStep[]; commands: string[] } | null>(null);
  const [runPlanOpen, setRunPlanOpen] = useState(false);
  const [pendingRunPlan, setPendingRunPlan] = useState<WorkflowRunLog | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<Record<string, WorkflowRunLog>>({});
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [runParamValues, setRunParamValues] = useState<Record<string, Record<string, string>>>({});
  const [paramPromptOpen, setParamPromptOpen] = useState(false);
  const [paramPromptWorkflow, setParamPromptWorkflow] = useState<WorkflowDetail | null>(null);
  const [search, setSearch] = useState('');
  const runStorageKey = workspacePath ? `anvil-workflow-runs:${workspacePath}` : null;

  const updateRun = (runId: string, mutator: (current: WorkflowRunLog) => WorkflowRunLog) => {
    setWorkflowRuns((prev) => {
      const next = { ...prev };
      const current = Object.values(next).find((item) => item.id === runId);
      if (!current) {
        return prev;
      }
      const updated = mutator(current);
      next[updated.workflowId] = {
        ...updated,
        updatedAt: new Date().toISOString()
      };
      return next;
    });
  };

  const setRunForWorkflow = (run: WorkflowRunLog) => {
    setWorkflowRuns((prev) => ({
      ...prev,
      [run.workflowId]: {
        ...run,
        updatedAt: new Date().toISOString()
      }
    }));
  };

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

  useEffect(() => {
    if (!runStorageKey) {
      setWorkflowRuns({});
      return;
    }
    const raw = window.localStorage.getItem(runStorageKey);
    if (!raw) {
      setWorkflowRuns({});
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, WorkflowRunLog>;
      setWorkflowRuns(parsed || {});
    } catch (_) {
      setWorkflowRuns({});
    }
  }, [runStorageKey]);

  useEffect(() => {
    if (!runStorageKey) return;
    window.localStorage.setItem(runStorageKey, JSON.stringify(workflowRuns));
  }, [runStorageKey, workflowRuns]);

  useEffect(() => {
    if (editing) return;
    if (workflows.length === 0) {
      setSelectedId(null);
      setWorkflowDetail(null);
      return;
    }
    if (!selectedId || !workflows.find((workflow) => workflow.id === selectedId)) {
      const next = workflows[0];
      setSelectedId(next.id);
      loadDetail(next.id);
    }
  }, [editing, selectedId, workflows]);

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
        setSelectedId(null);
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
      setSelectedId(id);
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

  const validateWorkflowForRun = (workflow: WorkflowDetail, values: Record<string, string>) => {
    if (workflow.steps.length === 0) {
      return 'Workflow has no steps.';
    }
    for (const [index, step] of workflow.steps.entries()) {
      if (!step.command.trim()) {
        return `Step ${index + 1} has an empty command.`;
      }
    }
    const keys = extractParamKeys(workflow.steps);
    const missing = getMissingParams(keys, values);
    if (missing.length > 0) {
      return `Missing required parameters: ${missing.join(', ')}`;
    }
    return null;
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

  const runAutoSteps = async (state: { runId: string; workflowId: string; index: number; steps: WorkflowStep[]; commands: string[] }) => {
    const ready = await ensureTerminalReady();
    if (!ready) {
      updateRun(state.runId, (current) => ({
        ...current,
        status: 'failed',
        phase: 'review'
      }));
      return;
    }
    let index = state.index;
    while (index < state.steps.length) {
      const step = state.steps[index];
      const command = state.commands[index];
      const requiresApproval = step.requires_approval !== false;
      updateRun(state.runId, (current) => {
        const nextSteps: WorkflowRunStepLog[] = current.steps.map((item, itemIndex): WorkflowRunStepLog => {
          if (itemIndex === index) {
            return {
              ...item,
              status: requiresApproval ? 'waiting_approval' : 'running',
              startedAt: requiresApproval ? item.startedAt : new Date().toISOString(),
              message: requiresApproval ? 'Waiting for approval' : 'Executing step'
            };
          }
          return item;
        });
        return {
          ...current,
          phase: 'execute',
          status: requiresApproval ? 'awaiting_approval' : 'running',
          currentStepIndex: index,
          steps: nextSteps
        };
      });

      if (requiresApproval) {
        setRunState({ ...state, index });
        setRunConfirmOpen(true);
        return;
      }
      try {
        await invoke('write_terminal', { data: `${command}\n` });
        updateRun(state.runId, (current) => {
          const nextSteps: WorkflowRunStepLog[] = current.steps.map((item, itemIndex): WorkflowRunStepLog => {
            if (itemIndex === index) {
              return {
                ...item,
                status: 'completed',
                completedAt: new Date().toISOString(),
                message: 'Executed'
              };
            }
            return item;
          });
          return {
            ...current,
            status: 'running',
            phase: 'execute',
            currentStepIndex: index + 1,
            steps: nextSteps
          };
        });
      } catch (error) {
        updateRun(state.runId, (current) => {
          const nextSteps: WorkflowRunStepLog[] = current.steps.map((item, itemIndex): WorkflowRunStepLog => {
            if (itemIndex === index) {
              return {
                ...item,
                status: 'failed',
                completedAt: new Date().toISOString(),
                message: `Failed to execute: ${String(error)}`
              };
            }
            return item;
          });
          return {
            ...current,
            status: 'failed',
            phase: 'review',
            currentStepIndex: index,
            steps: nextSteps
          };
        });
        setRunState(null);
        setErrorMessage('Workflow step failed. Review the run log and resume when ready.');
        return;
      }
      index += 1;
    }
    updateRun(state.runId, (current) => ({
      ...current,
      status: 'completed',
      phase: 'review',
      completedAt: new Date().toISOString(),
      currentStepIndex: current.steps.length
    }));
    setRunState(null);
  };

  const runWorkflow = (workflow: WorkflowDetail) => {
    if (promptForParamsIfNeeded(workflow)) return;
    const values = runParamValues[workflow.id] || {};
    const validationError = validateWorkflowForRun(workflow, values);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const runLog: WorkflowRunLog = {
      id: createId(),
      workflowId: workflow.id,
      workflowName: workflow.name || workflow.id,
      phase: 'plan',
      status: 'planned',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentStepIndex: 0,
      params: values,
      steps: workflow.steps.map((step) => ({
        id: step.id,
        title: step.title || 'Step',
        command: buildRunCommand(step, values),
        requiresApproval: step.requires_approval !== false,
        status: 'pending'
      }))
    };

    setPendingRunPlan(runLog);
    setRunPlanOpen(true);
  };

  const startPlannedRun = async () => {
    if (!pendingRunPlan) return;
    const runLog = {
      ...pendingRunPlan,
      phase: 'execute' as WorkflowRunPhase,
      status: 'running' as WorkflowRunStatus
    };
    setRunForWorkflow(runLog);
    setRunPlanOpen(false);
    setPendingRunPlan(null);

    const steps: WorkflowStep[] = runLog.steps.map((step) => ({
      id: step.id,
      title: step.title,
      command: step.command,
      requires_approval: step.requiresApproval
    }));
    const commands = runLog.steps.map((step) => step.command);
    const nextState = { runId: runLog.id, workflowId: runLog.workflowId, index: 0, steps, commands };
    await runAutoSteps(nextState);
  };

  const handleCancelPlannedRun = () => {
    setRunPlanOpen(false);
    setPendingRunPlan(null);
  };

  const resumeRun = async (runLog: WorkflowRunLog) => {
    if (runLog.currentStepIndex >= runLog.steps.length) {
      return;
    }
    const steps: WorkflowStep[] = runLog.steps.map((step) => ({
      id: step.id,
      title: step.title,
      command: step.command,
      requires_approval: step.requiresApproval
    }));
    const commands = runLog.steps.map((step) => step.command);
    updateRun(runLog.id, (current) => ({
      ...current,
      status: 'running',
      phase: 'execute'
    }));
    const nextState = {
      runId: runLog.id,
      workflowId: runLog.workflowId,
      index: runLog.currentStepIndex,
      steps,
      commands
    };
    await runAutoSteps(nextState);
  };

  const handleConfirmRunStep = async () => {
    if (!runState) return;
    const runLog = Object.values(workflowRuns).find((item) => item.id === runState.runId);
    if (!runLog) return;

    const ready = await ensureTerminalReady();
    if (!ready) return;

    const command = runState.commands[runState.index];
    updateRun(runState.runId, (current) => {
      const nextSteps: WorkflowRunStepLog[] = current.steps.map((item, index): WorkflowRunStepLog => {
        if (index === runState.index) {
          return {
            ...item,
            status: 'running',
            startedAt: item.startedAt || new Date().toISOString(),
            message: 'Executing after approval'
          };
        }
        return item;
      });
      return {
        ...current,
        status: 'running',
        phase: 'execute',
        steps: nextSteps
      };
    });

    try {
      await invoke('write_terminal', { data: `${command}\n` });
    } catch (error) {
      updateRun(runState.runId, (current) => {
        const nextSteps: WorkflowRunStepLog[] = current.steps.map((item, index): WorkflowRunStepLog => {
          if (index === runState.index) {
            return {
              ...item,
              status: 'failed',
              completedAt: new Date().toISOString(),
              message: `Failed to execute: ${String(error)}`
            };
          }
          return item;
        });
        return {
          ...current,
          status: 'failed',
          phase: 'review',
          steps: nextSteps
        };
      });
      setRunConfirmOpen(false);
      setRunState(null);
      setErrorMessage('Workflow step failed. Review the run log and resume when ready.');
      return;
    }

    updateRun(runState.runId, (current) => {
      const nextSteps: WorkflowRunStepLog[] = current.steps.map((item, index): WorkflowRunStepLog => {
        if (index === runState.index) {
          return {
            ...item,
            status: 'completed',
            completedAt: new Date().toISOString(),
            message: 'Executed'
          };
        }
        return item;
      });
      return {
        ...current,
        status: 'running',
        phase: 'execute',
        currentStepIndex: runState.index + 1,
        steps: nextSteps
      };
    });

    const nextIndex = runState.index + 1;
    const nextState = { ...runState, index: nextIndex };
    setRunConfirmOpen(false);
    await runAutoSteps(nextState);
  };

  const handleCancelRun = () => {
    setRunConfirmOpen(false);
    if (runState) {
      updateRun(runState.runId, (current) => ({
        ...current,
        status: 'paused',
        phase: 'execute'
      }));
    }
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

  const moveStep = (index: number, direction: -1 | 1) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      const current = steps[index];
      steps[index] = steps[nextIndex];
      steps[nextIndex] = current;
      return { ...prev, steps };
    });
  };

  const duplicateStep = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const target = prev.steps[index];
      if (!target) return prev;
      const duplicated: WorkflowStep = {
        ...target,
        id: createId(),
        title: target.title ? `${target.title} Copy` : `Step ${index + 1} Copy`
      };
      const steps = [...prev.steps];
      steps.splice(index + 1, 0, duplicated);
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
    setErrorMessage(null);
    try {
      await invoke('delete_workflow', {
        workspacePath,
        workflowId
      });
      if (selectedId === workflowId) {
        setSelectedId(null);
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

  const handleSelect = (id: string) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const handleRunById = async (id: string) => {
    if (!workspacePath) return;
    try {
      const detail = await invoke<WorkflowDetail>('load_workflow', {
        workspacePath,
        workflowId: id
      });
      setWorkflowDetail(detail);
      setSelectedId(id);
      runWorkflow(detail);
    } catch (error) {
      console.error('Failed to run workflow:', error);
      setErrorMessage('Failed to run workflow.');
    }
  };

  const formatTimestamp = (value?: string) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString();
  };

  const formatTimestampTime = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const getRunStatusLabel = (status: WorkflowRunStatus) => {
    switch (status) {
      case 'planned':
        return 'Planned';
      case 'running':
        return 'Running';
      case 'awaiting_approval':
        return 'Awaiting Approval';
      case 'paused':
        return 'Paused';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  };

  const getRunStatusClass = (status: WorkflowRunStatus) => {
    switch (status) {
      case 'completed':
        return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
      case 'failed':
        return 'border-red-500/40 bg-red-500/10 text-red-300';
      case 'awaiting_approval':
      case 'paused':
        return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
      case 'running':
        return 'border-blue-500/40 bg-blue-500/10 text-blue-300';
      default:
        return 'border-[var(--border)] bg-[var(--bg-base)] text-zinc-300';
    }
  };

  const getStepStatusLabel = (status: WorkflowRunStepStatus) => {
    switch (status) {
      case 'waiting_approval':
        return 'Waiting Approval';
      case 'pending':
        return 'Pending';
      case 'running':
        return 'Running';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'skipped':
        return 'Skipped';
      default:
        return status;
    }
  };

  const getStepStatusClass = (status: WorkflowRunStepStatus) => {
    switch (status) {
      case 'completed':
        return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
      case 'failed':
        return 'border-red-500/30 bg-red-500/10 text-red-300';
      case 'running':
        return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
      case 'waiting_approval':
        return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
      default:
        return 'border-[var(--border)] bg-[var(--bg-base)] text-zinc-400';
    }
  };

  const filteredWorkflows = workflows.filter((workflow) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return workflow.name.toLowerCase().includes(needle)
      || (workflow.description || '').toLowerCase().includes(needle);
  });
  const selectedRun = workflowDetail ? workflowRuns[workflowDetail.id] : null;
  const isEditorFocus = editing && !!draft;

  if (!workspacePath) {
    return (
      <div className="p-4 text-sm text-zinc-500 text-center">
        Select a workspace to view workflows
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {!isEditorFocus && (
      <div className="flex w-80 flex-col border-r border-[var(--border)]">
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
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
          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workflows"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          {errorMessage && (
            <div className="mt-2 text-xs text-red-400">{errorMessage}</div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center text-xs text-zinc-500 py-4">Loading workflows...</div>
          ) : filteredWorkflows.length === 0 ? (
            <div className="text-center text-xs text-zinc-500 py-6">
              {workflows.length === 0 ? 'No workflows yet. Create one.' : 'No workflows match your search.'}
            </div>
          ) : (
            filteredWorkflows.map((workflow) => {
              const isSelected = selectedId === workflow.id;
              return (
                <div
                  key={workflow.id}
                  className={clsx(
                    "group rounded-lg border px-3 py-2 transition-all cursor-pointer",
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)]/40"
                  )}
                  onClick={() => handleSelect(workflow.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">
                        {workflow.name || workflow.id}
                      </div>
                      {workflow.description && (
                        <div className="text-[11px] text-zinc-500 line-clamp-1">
                          {workflow.description}
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded shrink-0">
                      {workflow.steps ?? 0}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
                    <span>{formatTimestamp(workflow.updated_at || workflow.created_at) || '—'}</span>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRunById(workflow.id);
                        }}
                        className="text-zinc-400 hover:text-[var(--accent)]"
                        title="Run workflow"
                      >
                        <Terminal size={12} />
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditWorkflow(workflow.id);
                        }}
                        className="text-zinc-400 hover:text-zinc-200"
                        title="Edit workflow"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          handleAskDelete(workflow.id, workflow.name || workflow.id);
                        }}
                        className="text-zinc-400 hover:text-red-400"
                        title="Delete workflow"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-[var(--border)] p-3 text-[11px] text-zinc-600">
          Workflows stored in .anvil/workflows
        </div>
      </div>
      )}

        <div className={clsx(
          "flex-1 overflow-y-auto",
          isEditorFocus ? "p-4 md:p-8 lg:p-10" : "p-6"
        )}>
          {editing && draft ? (
          <div className="mx-auto w-full max-w-[1500px] rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 lg:p-8 space-y-6 min-h-[82vh]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Workflow Editor</div>
                <div className="mt-1 text-sm text-zinc-500">Build steps, parameters, and approvals in one place.</div>
                <div className="mt-2 text-xs text-zinc-500">{draft.steps.length} step{draft.steps.length === 1 ? '' : 's'} configured</div>
              </div>
              <button
                onClick={handleCancel}
                className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                title="Close editor"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-xs uppercase tracking-wider text-zinc-500">Workflow Name</label>
              <input
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder="Workflow name"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-4 py-2.5 text-base text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
              />
              <label className="text-xs uppercase tracking-wider text-zinc-500">Description</label>
              <textarea
                value={draft.description || ''}
                onChange={(e) => updateDraft({ description: e.target.value })}
                placeholder="What this workflow is for (optional)"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-4 py-2.5 text-sm text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                rows={3}
              />
            </div>

            {draftParamKeys.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-wider text-zinc-500">Parameters</div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {draftParamKeys.map((key) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <label className="text-xs text-zinc-500">{key}</label>
                      <input
                        value={paramValues[key] || ''}
                        onChange={(e) => setParamValues((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={`Value for ${key}`}
                        className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  ))}
                </div>
                <div className="text-xs text-zinc-500">Use placeholders like {'{{param}}'} inside step commands.</div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-zinc-500">Steps</div>
                <button
                  onClick={addStep}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/60"
                >
                  Add Step
                </button>
              </div>
              <div className="space-y-3">
                {draft.steps.map((step, index) => (
                  <div key={step.id} className="rounded-xl border border-zinc-800/60 bg-[#09090b] p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-1 text-xs text-zinc-400">
                        Step {index + 1}
                      </div>
                      <input
                        value={step.title}
                        onChange={(e) => updateStep(index, { title: e.target.value })}
                        placeholder={`Step ${index + 1} title`}
                        className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0}
                        className={clsx(
                          "shrink-0 rounded-lg border border-[var(--border)] px-2 py-2 text-zinc-300 hover:bg-zinc-800/60",
                          index === 0 && "opacity-40 cursor-not-allowed"
                        )}
                        title="Move step up"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => moveStep(index, 1)}
                        disabled={index === draft.steps.length - 1}
                        className={clsx(
                          "shrink-0 rounded-lg border border-[var(--border)] px-2 py-2 text-zinc-300 hover:bg-zinc-800/60",
                          index === draft.steps.length - 1 && "opacity-40 cursor-not-allowed"
                        )}
                        title="Move step down"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={() => duplicateStep(index)}
                        className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-2 text-zinc-300 hover:bg-zinc-800/60"
                        title="Duplicate step"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={() => removeStep(index)}
                        className="shrink-0 rounded-lg border border-red-500/30 px-2.5 py-2 text-xs text-red-300 hover:bg-red-500/10"
                        title="Remove step"
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      value={step.command}
                      onChange={(e) => updateStep(index, { command: e.target.value })}
                      placeholder="Command (e.g. npm test)"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm font-mono font-normal text-zinc-200 focus:outline-none focus:border-[var(--accent)]"
                      rows={2}
                    />
                    {step.command.includes('{{') && (
                      <div className="text-xs text-zinc-500">
                        Preview: <span className="font-mono text-zinc-300">{resolveCommand(step.command, paramValues)}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <input
                        value={step.working_dir || ''}
                        onChange={(e) => updateStep(index, { working_dir: e.target.value })}
                        placeholder="Working directory (optional)"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                      />
                      <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-xs text-zinc-300 uppercase tracking-wider">
                        <input
                          type="checkbox"
                          checked={step.requires_approval ?? true}
                          onChange={(e) => updateStep(index, { requires_approval: e.target.checked })}
                        />
                        Require approval
                      </label>
                    </div>
                    <textarea
                      value={step.description || ''}
                      onChange={(e) => updateStep(index, { description: e.target.value })}
                      placeholder="Step description (optional)"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-zinc-200 font-normal focus:outline-none focus:border-[var(--accent)]"
                      rows={3}
                    />
                  </div>
                ))}
              </div>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
            )}

            <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-surface)]/95 backdrop-blur px-0 py-4">
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800/60"
              >
                <X size={14} />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white shadow-lg shadow-purple-900/20 hover:bg-[var(--accent)]/90 disabled:opacity-60"
              >
                <Save size={14} />
                {saving ? 'Saving' : 'Save Workflow'}
              </button>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="text-xs text-zinc-500">Loading workflow...</div>
        ) : workflowDetail ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xl font-semibold text-zinc-100">{workflowDetail.name || workflowDetail.id}</div>
                {workflowDetail.description && (
                  <div className="mt-1 text-sm text-zinc-500 max-w-2xl">{workflowDetail.description}</div>
                )}
                <div className="mt-2 text-[11px] text-zinc-500">{workflowDetail.steps.length} steps • Updated {formatTimestamp(workflowDetail.updated_at || workflowDetail.created_at) || '—'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => startEditWorkflow(workflowDetail.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
                >
                  <Pencil size={12} />
                  Edit
                </button>
                <button
                  onClick={() => runWorkflow(workflowDetail)}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-purple-900/20 hover:bg-[var(--accent)]/90"
                >
                  <Terminal size={12} />
                  Run Workflow
                </button>
              </div>
            </div>

            {(() => {
              const keys = extractParamKeys(workflowDetail.steps);
              if (keys.length === 0) return null;
              const values = runParamValues[workflowDetail.id] || {};
              return (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-3">
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

            {selectedRun && (() => {
              const canResume = selectedRun.currentStepIndex < selectedRun.steps.length
                && (selectedRun.status === 'paused' || selectedRun.status === 'failed' || selectedRun.status === 'awaiting_approval');
              return (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">Latest Run</div>
                      <div className="text-xs text-zinc-400 mt-1">
                        Started {formatTimestampTime(selectedRun.startedAt)} • Updated {formatTimestampTime(selectedRun.updatedAt)}
                      </div>
                    </div>
                    <span className={clsx(
                      "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                      getRunStatusClass(selectedRun.status)
                    )}>
                      {getRunStatusLabel(selectedRun.status)}
                    </span>
                  </div>

                  {selectedRun.completedAt && (
                    <div className="text-[11px] text-zinc-500">Completed {formatTimestampTime(selectedRun.completedAt)}</div>
                  )}

                  <div className="flex items-center gap-2">
                    {canResume && (
                      <button
                        onClick={() => void resumeRun(selectedRun)}
                        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
                      >
                        <Play size={12} />
                        Resume
                      </button>
                    )}
                    <button
                      onClick={() => runWorkflow(workflowDetail)}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
                    >
                      <RotateCcw size={12} />
                      New Run
                    </button>
                  </div>

                  <div className="space-y-2">
                    {selectedRun.steps.map((step, index) => {
                      const isCurrentStep = index === selectedRun.currentStepIndex && selectedRun.status !== 'completed';
                      return (
                        <div
                          key={`${selectedRun.id}-${step.id}-${index}`}
                          className={clsx(
                            "rounded-lg border px-3 py-2",
                            isCurrentStep ? "border-[var(--accent)]/40 bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--bg-base)]"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-zinc-200 truncate">{index + 1}. {step.title}</div>
                            <span className={clsx(
                              "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                              getStepStatusClass(step.status)
                            )}>
                              {getStepStatusLabel(step.status)}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] font-mono text-zinc-400 break-all">{step.command}</div>
                          {step.message && (
                            <div className="mt-1 text-[10px] text-zinc-500">{step.message}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {workflowDetail.steps.length === 0 ? (
              <div className="text-xs text-zinc-500">No steps defined.</div>
            ) : (
              <div className="space-y-3">
                {workflowDetail.steps.map((step, index) => (
                  <div key={step.id || `${workflowDetail.id}-${index}`} className="rounded-xl border border-zinc-800/60 bg-[#09090b] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Terminal size={12} className="text-[var(--accent)]" />
                      <div className="text-sm font-semibold text-zinc-200">{step.title || `Step ${index + 1}`}</div>
                      {step.requires_approval && (
                        <span className="text-[10px] text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">Approval</span>
                      )}
                    </div>
                    <div className="mt-2 text-[12px] font-mono text-zinc-300 break-all">{step.command}</div>
                    {step.command.includes('{{') && (
                      <div className="mt-1 text-[10px] text-zinc-500">
                        Preview: <span className="font-mono text-zinc-300">{resolveCommand(step.command, runParamValues[workflowDetail.id] || {})}</span>
                      </div>
                    )}
                    {step.description && (
                      <div className="mt-2 text-xs text-zinc-500">{step.description}</div>
                    )}
                    {step.working_dir && (
                      <div className="mt-2 text-[10px] text-zinc-600">Dir: {step.working_dir}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">Select a workflow to see details.</div>
        )}
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
        open={runPlanOpen}
        title="Review Workflow Plan"
        subtitle={pendingRunPlan ? `${pendingRunPlan.workflowName} • ${pendingRunPlan.steps.length} steps` : undefined}
        confirmLabel="Start Run"
        cancelLabel="Cancel"
        confirmTone="primary"
        icon={<Terminal size={18} />}
        widthClassName="w-[640px]"
        confirmDisabled={!pendingRunPlan || pendingRunPlan.steps.length === 0}
        onCancel={handleCancelPlannedRun}
        onConfirm={() => {
          void startPlannedRun();
        }}
        body={pendingRunPlan ? (
          <div className="space-y-3">
            <div className="text-xs text-zinc-400">
              Confirm this execution plan before running commands in the terminal.
            </div>
            {Object.keys(pendingRunPlan.params).length > 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Parameters</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(pendingRunPlan.params).map(([key, value]) => (
                    <div key={key} className="text-[11px] text-zinc-400">
                      <span className="text-zinc-500">{key}:</span> {value}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {pendingRunPlan.steps.map((step, index) => (
                <div key={`${step.id}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-zinc-200 truncate">{index + 1}. {step.title}</div>
                    <span className={clsx(
                      "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                      step.requiresApproval
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        : "border-zinc-700/80 bg-zinc-800/70 text-zinc-400"
                    )}>
                      {step.requiresApproval ? 'Approval' : 'Auto'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-zinc-400 break-all">{step.command}</div>
                </div>
              ))}
            </div>
          </div>
        ) : undefined}
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
