import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionCard, ThinkingBlock, MessageCard, StatusIndicator } from '../ActivityCards'

describe('ActionCard', () => {
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

  it('toggles content when clicked', () => {
    render(
      <ActionCard
        type="execute"
        title="Running npm test"
        content="Test output here"
        status="running"
      />
    )

    // Content should not be in the document when collapsed (default)
    expect(screen.queryByText('Test output here')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByText('Running npm test'))
    expect(screen.getByText('Test output here')).toBeVisible()
  })

  it('shows correct status icon', () => {
    const { rerender } = render(
      <ActionCard
        type="write"
        title="Writing file"
        status="pending"
      />
    )

    expect(screen.getByText('Queued')).toBeInTheDocument()

    rerender(
      <ActionCard
        type="write"
        title="Writing file"
        status="success"
      />
    )

    expect(screen.getByText('Done')).toBeInTheDocument()
  })
})

describe('ThinkingBlock', () => {
  it('renders thinking indicator when isThinking is true', () => {
    render(
      <ThinkingBlock content="Analyzing project structure..." isThinking={true} />
    )

    expect(screen.getByText('Thinking')).toBeInTheDocument()
  })

  it('shows collapsed content preview', () => {
    const longContent = 'A'.repeat(150)
    render(
      <ThinkingBlock content={longContent} isThinking={false} />
    )

    // Should show truncated content with "..."
    const preview = screen.getByText(/A+\.\.\./)
    expect(preview).toBeInTheDocument()
  })
})

describe('MessageCard', () => {
  it('renders user message correctly', () => {
    render(
      <MessageCard
        role="user"
        content="Hello, can you help me?"
      />
    )

    expect(screen.getByText('Hello, can you help me?')).toBeInTheDocument()
  })

  it('renders assistant message correctly', () => {
    render(
      <MessageCard
        role="assistant"
        content="I'd be happy to help!"
      />
    )

    expect(screen.getByText("I'd be happy to help!")).toBeInTheDocument()
    expect(screen.getByText('Response')).toBeInTheDocument()
  })
})

describe('StatusIndicator', () => {
  it('renders with correct status label', () => {
    render(<StatusIndicator status="planning" />)
    expect(screen.getByText('Planning')).toBeInTheDocument()
  })

  it('renders with custom message', () => {
    render(<StatusIndicator status="implementing" message="Writing code..." />)
    expect(screen.getByText('Writing code...')).toBeInTheDocument()
  })

  it('shows all status types correctly', () => {
    const statuses = ['planning', 'researching', 'implementing', 'executing', 'testing', 'waiting', 'responding', 'done'] as const
    
    statuses.forEach((status, index) => {
      const { unmount } = render(<StatusIndicator key={index} status={status} />)
      expect(screen.getByText(status.charAt(0).toUpperCase() + status.slice(1))).toBeInTheDocument()
      unmount()
    })
  })
})
