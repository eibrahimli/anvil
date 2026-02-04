import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionCard } from '../ActivityCards'

describe('ActionCard Component', () => {
  describe('Rendering', () => {
    it('renders with correct title and status', () => {
      render(
        <ActionCard
          type="read"
          title="Reading src/main.ts"
          description="File read operation"
          content="File content here"
          status="success"
        />
      )

      expect(screen.getByText('Reading src/main.ts')).toBeInTheDocument()
      expect(screen.getByText('File read operation')).toBeInTheDocument()
    })

    it('renders without description when not provided', () => {
      render(
        <ActionCard
          type="write"
          title="Writing file"
          status="pending"
        />
      )

      expect(screen.getByText('Writing file')).toBeInTheDocument()
      // Description should not be in document
      const allText = document.body.textContent || ''
      expect(allText.includes('description')).toBe(false)
    })

    it('renders with correct icon based on type', () => {
      const { rerender } = render(
        <ActionCard
          type="read"
          title="Test"
          status="success"
        />
      )

      // Should have SVG icon
      const icon = document.querySelector('svg')
      expect(icon).toBeInTheDocument()

      rerender(
        <ActionCard
          type="execute"
          title="Test"
          status="success"
        />
      )

      // Icon should still exist
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('renders all tool types correctly', () => {
      const types: Array<'read' | 'write' | 'execute' | 'search' | 'edit' | 'generic'> = 
        ['read', 'write', 'execute', 'search', 'edit', 'generic']

      types.forEach(type => {
        const { unmount } = render(
          <ActionCard
            key={type}
            type={type}
            title={`${type} operation`}
            status="success"
          />
        )
        expect(screen.getByText(`${type} operation`)).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('Status States', () => {
    it('shows pending state with correct styling', () => {
      render(
        <ActionCard
          type="write"
          title="Writing file"
          status="pending"
        />
      )

      const container = document.querySelector('.rounded-lg')
      expect(container).toHaveClass('bg-zinc-800/50')
      expect(container).toHaveClass('border-zinc-700')
    })

    it('shows running state with correct styling', () => {
      render(
        <ActionCard
          type="execute"
          title="Running command"
          status="running"
        />
      )

      const container = document.querySelector('.rounded-lg')
      expect(container).toHaveClass('bg-blue-900/20')
      expect(container).toHaveClass('border-blue-800/50')

      // Loader icon should have animate-spin class
      const loader = document.querySelector('.animate-spin')
      expect(loader).toBeInTheDocument()
    })

    it('shows success state with correct styling', () => {
      render(
        <ActionCard
          type="read"
          title="Reading file"
          content="File content"
          status="success"
        />
      )

      const container = document.querySelector('.rounded-lg')
      expect(container).toHaveClass('bg-green-900/20')
      expect(container).toHaveClass('border-green-800/50')

      // CheckCircle icon (not spinning)
      const spinningElements = document.querySelectorAll('.animate-spin')
      expect(spinningElements.length).toBe(0)
    })

    it('shows error state with correct styling', () => {
      render(
        <ActionCard
          type="edit"
          title="Editing file"
          content="Error occurred"
          status="error"
        />
      )

      const container = document.querySelector('.rounded-lg')
      expect(container).toHaveClass('bg-red-900/20')
      expect(container).toHaveClass('border-red-800/50')
    })

    it('cycles through all status types', () => {
      const statuses: Array<'pending' | 'running' | 'success' | 'error'> = 
        ['pending', 'running', 'success', 'error']

      statuses.forEach(status => {
        const { unmount } = render(
          <ActionCard
            key={status}
            type="read"
            title={`Status: ${status}`}
            status={status}
          />
        )
        expect(screen.getByText(`Status: ${status}`)).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('Collapsible Behavior', () => {
    it('shows content collapsed by default', () => {
      const longContent = 'A'.repeat(50)
      
      render(
        <ActionCard
          type="execute"
          title="Running command"
          content={longContent}
          status="success"
          defaultCollapsed={true}
        />
      )

      // Content should not be visible when collapsed
      expect(screen.queryByText(/A/)).not.toBeInTheDocument()
    })

    it('shows content expanded by default when defaultCollapsed is false', () => {
      const content = 'This is the content'
      
      render(
        <ActionCard
          type="read"
          title="Reading file"
          content={content}
          status="success"
          defaultCollapsed={false}
        />
      )

      expect(screen.getByText(content)).toBeInTheDocument()
    })

    it('expands content when header is clicked', () => {
      const content = 'This is the content that should appear after clicking'
      
      render(
        <ActionCard
          type="write"
          title="Writing file"
          content={content}
          status="success"
          defaultCollapsed={true}
        />
      )

      // Content should not be visible initially
      expect(screen.queryByText(content)).not.toBeInTheDocument()

      // Click header to expand
      const header = screen.getByText('Writing file').parentElement
      fireEvent.click(header!)

      // Content should now be visible
      expect(screen.getByText(content)).toBeInTheDocument()
    })

    it('collapses content again when clicked twice', () => {
      const content = 'Collapsible content'
      
      render(
        <ActionCard
          type="search"
          title="Searching files"
          content={content}
          status="success"
          defaultCollapsed={true}
        />
      )

      const header = screen.getByText('Searching files').parentElement
      
      // First click - expand
      fireEvent.click(header!)
      expect(screen.getByText(content)).toBeInTheDocument()

      // Second click - collapse
      fireEvent.click(header!)
      expect(screen.queryByText(content)).not.toBeInTheDocument()
    })

    it('keeps content visible when isCollapsible is false', () => {
      const content = 'Non-collapsible content'
      
      render(
        <ActionCard
          type="edit"
          title="Editing file"
          content={content}
          status="success"
          isCollapsible={false}
          defaultCollapsed={false}
        />
      )

      // Content should always be visible when isCollapsible=false
      const contentElement = screen.queryByText(content)
      expect(contentElement).toBeInTheDocument()
    })
  })

  describe('Content Display', () => {
    it('renders content in pre tag with proper styling', () => {
      const content = 'Line 1\nLine 2\nLine 3'
      
      render(
        <ActionCard
          type="read"
          title="Reading file"
          content={content}
          status="success"
          defaultCollapsed={false}
        />
      )

      const preElement = document.querySelector('pre')
      expect(preElement).toBeInTheDocument()
      expect(preElement).toHaveClass('font-mono')
      expect(preElement).toHaveClass('text-zinc-400')
    })

    it('truncates title with overflow', () => {
      const longTitle = 'This is a very long title that should be truncated with an ellipsis when it overflows the available space'
      
      render(
        <ActionCard
          type="write"
          title={longTitle}
          status="success"
        />
      )

      const titleElement = screen.getByText(/This is a very long/)
      expect(titleElement).toHaveClass('truncate')
    })

    it('handles empty content gracefully', () => {
      render(
        <ActionCard
          type="execute"
          title="Running command"
          content=""
          status="success"
          defaultCollapsed={false}
        />
      )

      // Should not crash and should still render
      expect(screen.getByText('Running command')).toBeInTheDocument()
    })

    it('handles null content gracefully', () => {
      render(
        <ActionCard
          type="search"
          title="Searching"
          status="success"
          defaultCollapsed={false}
        />
      )

      // Should not crash and should still render
      expect(screen.getByText('Searching')).toBeInTheDocument()
    })
  })

  describe('Visual Styling', () => {
    it('applies border styles correctly', () => {
      render(
        <ActionCard
          type="read"
          title="Test"
          status="success"
        />
      )

      const container = document.querySelector('.rounded-lg')
      expect(container).toHaveClass('border')
      expect(container).toHaveClass('overflow-hidden')
    })

    it('applies transition animation classes', () => {
      render(
        <ActionCard
          type="write"
          title="Test"
          content="Content"
          status="success"
          defaultCollapsed={false}
        />
      )

      const container = document.querySelector('.transition-all')
      expect(container).toHaveClass('duration-200')
    })

    it('maintains proper spacing between icon and title', () => {
      render(
        <ActionCard
          type="execute"
          title="Running npm test"
          status="running"
        />
      )

      const header = document.querySelector('.flex.items-center')
      expect(header).toHaveClass('gap-3')
    })
  })

  describe('Icon Rendering', () => {
    it('renders FileText icon for read operations', () => {
      render(
        <ActionCard
          type="read"
          title="Reading file"
          status="success"
        />
      )

      // Icon should be present
      const icon = document.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('renders Terminal icon for execute operations', () => {
      render(
        <ActionCard
          type="execute"
          title="Running command"
          status="success"
        />
      )

      // Icon should be present
      const icon = document.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('renders CheckCircle icon for success status', () => {
      render(
        <ActionCard
          type="read"
          title="Test"
          content="Content"
          status="success"
          defaultCollapsed={false}
        />
      )

      // Status icon should be present (green check circle)
      const statusIconContainer = document.querySelectorAll('svg')
      expect(statusIconContainer.length).toBeGreaterThan(0)
    })

    it('renders XCircle icon for error status', () => {
      render(
        <ActionCard
          type="write"
          title="Test"
          content="Error content"
          status="error"
          defaultCollapsed={false}
        />
      )

      // Status icon should be present
      const statusIconContainer = document.querySelectorAll('svg')
      expect(statusIconContainer.length).toBeGreaterThan(0)
    })

    it('renders Loader2 icon with animation for running status', () => {
      render(
        <ActionCard
          type="execute"
          title="Test"
          status="running"
        />
      )

      // Animated loader should be present
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('Max Height and Scroll', () => {
    it('applies max-height to expanded content', () => {
      const longContent = 'A\n'.repeat(50)
      
      render(
        <ActionCard
          type="read"
          title="Reading file"
          content={longContent}
          status="success"
          defaultCollapsed={false}
        />
      )

      const preElement = document.querySelector('pre')
      expect(preElement).toHaveClass('max-h-48')
      expect(preElement).toHaveClass('overflow-y-auto')
    })

    it('scrolls long content within max-height', () => {
      const longContent = 'Line '.repeat(100)
      
      render(
        <ActionCard
          type="write"
          title="Writing file"
          content={longContent}
          status="success"
          defaultCollapsed={false}
        />
      )

      const preElement = document.querySelector('pre')
      expect(preElement).toHaveClass('overflow-y-auto')
    })
  })
})
