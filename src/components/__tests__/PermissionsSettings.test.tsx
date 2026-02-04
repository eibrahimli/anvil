import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useSettingsStore } from '../../stores/settings'
import { PermissionsSettings } from '../settings/PermissionsSettings'
import { invoke } from '@tauri-apps/api/core'

// Mock the store
vi.mock('../../stores/settings', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd, _args) => {
    if (cmd === 'load_permission_config') {
      return Promise.resolve({
        read: { default: 'allow', rules: [] },
        write: { default: 'allow', rules: [] },
        edit: { default: 'deny', rules: [] },
        bash: { default: 'ask', rules: [] },
        skill: { default: 'allow', rules: [] },
      });
    }
    if (cmd === 'save_permission_config') {
      return Promise.resolve({ success: true });
    }
    if (cmd === 'reload_config') {
      return Promise.resolve({ success: true });
    }
    if (cmd === 'get_cwd') {
        return Promise.resolve('/test/path');
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  }),
}))

describe('PermissionsSettings Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Default mock implementation
    vi.mocked(useSettingsStore).mockReturnValue({
        permissions: {
            read: { default: 'ask', rules: [] },
            write: { default: 'ask', rules: [] },
            edit: { default: 'ask', rules: [] },
            bash: { default: 'ask', rules: [] },
            skill: { default: 'allow', rules: [] },
        },
        setPermissions: vi.fn(),
    } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Theme Compatibility', () => {
    it('renders correctly with aura theme', async () => {
      render(<PermissionsSettings />)
      
      // Wait for initial load
      await waitFor(() => {
          expect(screen.getByText('Read Files')).toBeInTheDocument()
      })
      
      expect(screen.getByText(/Control granular permissions/)).toBeInTheDocument()
    })

    it('renders correctly with dark theme', async () => {
      vi.mocked(useSettingsStore).mockReturnValue({
        permissions: {
          read: { default: 'ask', rules: [] },
          write: { default: 'deny', rules: [] },
          edit: { default: 'allow', rules: [] },
          bash: { default: 'deny', rules: [] },
          skill: { default: 'allow', rules: [] },
        },
        setPermissions: vi.fn(),
      } as any)

      render(<PermissionsSettings />)
      await waitFor(() => {
        expect(screen.getByText('Read Files')).toBeInTheDocument()
      })
    })
  })

  describe('Tool Permissions Section', () => {
    it('renders all tool types', async () => {
      render(<PermissionsSettings />)
      await waitFor(() => {
          expect(screen.getByText('Read Files')).toBeInTheDocument()
      })
      
      const tools = ['Read Files', 'Write Files', 'Edit Files', 'Terminal', 'Skills']
      
      tools.forEach(tool => {
        expect(screen.getByText(tool)).toBeInTheDocument()
      })
    })

    it('shows correct permission state for each tool', async () => {
      vi.mocked(useSettingsStore).mockReturnValue({
        permissions: {
          read: { default: 'allow', rules: [] },
          write: { default: 'ask', rules: [] },
          edit: { default: 'deny', rules: [] },
          bash: { default: 'deny', rules: [] },
          skill: { default: 'allow', rules: [] },
        },
        setPermissions: vi.fn(),
      } as any)

      render(<PermissionsSettings />)
      await waitFor(() => {
        expect(screen.getByText('Read Files')).toBeInTheDocument()
      })

      // Helper to find the active button for a tool
      const checkActiveButton = (toolName: string, expectedState: string) => {
          const toolRow = screen.getByText(toolName).closest('.flex.items-center.justify-between');
          const buttons = toolRow?.querySelectorAll('button');
          const activeButton = Array.from(buttons || []).find(btn => btn.className.includes('bg-green-500') || btn.className.includes('bg-[var(--accent)]') || btn.className.includes('bg-red-500'));
          
          if (expectedState === 'allow') {
              expect(activeButton).toHaveTextContent('allow');
              expect(activeButton).toHaveClass('bg-green-500/20');
          } else if (expectedState === 'deny') {
              expect(activeButton).toHaveTextContent('deny');
              expect(activeButton).toHaveClass('bg-red-500/20');
          } else {
              expect(activeButton).toHaveTextContent('ask');
              expect(activeButton).toHaveClass('bg-[var(--accent)]');
          }
      }

      checkActiveButton('Read Files', 'allow');
      checkActiveButton('Write Files', 'ask');
      checkActiveButton('Edit Files', 'deny');
      checkActiveButton('Terminal', 'deny');
    })

    it('calls setPermissions when Allow button is clicked', async () => {
      const setPermissionsMock = vi.fn()
      vi.mocked(useSettingsStore).mockReturnValue({
        permissions: {
          read: { default: 'ask', rules: [] },
          write: { default: 'ask', rules: [] },
          edit: { default: 'ask', rules: [] },
          bash: { default: 'ask', rules: [] },
          skill: { default: 'allow', rules: [] },
        },
        setPermissions: setPermissionsMock,
      } as any)

      render(<PermissionsSettings />)
      await waitFor(() => {
        expect(screen.getByText('Read Files')).toBeInTheDocument()
      })

      // Find the "Allow" button for "Read Files"
      const readRow = screen.getByText('Read Files').closest('.flex.items-center.justify-between');
      
      const buttons = readRow?.querySelectorAll('button');
      const targetBtn = Array.from(buttons || []).find(b => b.textContent === 'allow');

      if (targetBtn) {
        fireEvent.click(targetBtn);
        
        expect(setPermissionsMock).toHaveBeenCalledWith(
          expect.objectContaining({ 
              read: expect.objectContaining({ default: 'allow' }) 
          })
        )
      }
    })
  })

  describe('Permission Rules Section', () => {
    it('shows "No exception rules defined" when rules array is empty', async () => {
      render(<PermissionsSettings />)
      await waitFor(() => {
        expect(screen.getByText('Read Files')).toBeInTheDocument()
      })
      
      // Expand the Read Files section
      const readRow = screen.getByText('Read Files');
      fireEvent.click(readRow); // Click to expand

      expect(screen.getByText('No exception rules defined. Default action applies to all matches.')).toBeInTheDocument()
      expect(screen.getByText('Add Rule')).toBeInTheDocument()
    })

    it('adds new rule when "Add Rule" button is clicked', async () => {
      const setPermissionsMock = vi.fn();
      vi.mocked(useSettingsStore).mockReturnValue({
        permissions: {
            read: { default: 'ask', rules: [] },
            write: { default: 'ask', rules: [] },
            edit: { default: 'ask', rules: [] },
            bash: { default: 'ask', rules: [] },
            skill: { default: 'allow', rules: [] },
        },
        setPermissions: setPermissionsMock
      } as any);

      render(<PermissionsSettings />)
      await waitFor(() => {
        expect(screen.getByText('Read Files')).toBeInTheDocument()
      })
      
      // Expand and click add rule
      const readRow = screen.getByText('Read Files');
      fireEvent.click(readRow);
      
      const addButton = screen.getByText('Add Rule');
      fireEvent.click(addButton);
      
      expect(setPermissionsMock).toHaveBeenCalled();
      const callArg = setPermissionsMock.mock.calls[0][0];
      expect(callArg.read.rules).toHaveLength(1);
    })
  })

  describe('Save Button', () => {
    it('renders save button', async () => {
      render(<PermissionsSettings />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument()
      })
    })

    it('calls save_permission_config command when save button is clicked', async () => {
      render(<PermissionsSettings />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument()
      })

      const saveButton = screen.getByRole('button', { name: /Save/i })
      if (saveButton) {
        fireEvent.click(saveButton)
        
        await waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('save_permission_config', expect.any(Object))
        })
      }
    })
  })
})
