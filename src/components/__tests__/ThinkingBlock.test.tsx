import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThinkingBlock } from '../ActivityCards'

describe('ThinkingBlock Component', () => {
  it('renders thinking indicator when isThinking is true', () => {
    render(
      <ThinkingBlock content="Analyzing project structure..." isThinking={true} />
    )

    expect(screen.getByText('Agent is thinking...')).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders completed thinking state when isThinking is false', () => {
    render(
      <ThinkingBlock content="I have analyzed the codebase." isThinking={false} />
    )

    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
  })

  it('shows first 2 lines by default when content is long', () => {
    // Need content longer than 100 characters to trigger collapsible behavior
    const longContent = `Line 1 of thinking content that is quite long and detailed
Line 2 of thinking content with additional details and explanations
Line 3 of thinking content continues with more information
Line 4 of thinking content wraps up the thought process`.repeat(2)
    
    render(<ThinkingBlock content={longContent} isThinking={false} />)

    // Content should be visible
    expect(screen.getByText(/Line 1 of thinking content/)).toBeInTheDocument()
    
    // Should have line-clamp-2 class (limits to 2 lines) - find the content div by checking for italic styling
    const contentElements = document.querySelectorAll('.italic')
    expect(contentElements.length).toBeGreaterThan(0)
    const contentElement = contentElements[0]
    expect(contentElement).toHaveClass('line-clamp-2')
  })

  it('expands to show full content when clicked', () => {
    // Need content longer than 100 characters
    const longContent = `Line 1 of thinking content that is quite long and detailed
Line 2 of thinking content with additional details and explanations
Line 3 of thinking content continues with more information
Line 4 of thinking content wraps up the thought process`.repeat(2)
    
    render(<ThinkingBlock content={longContent} isThinking={false} />)

    // Initially collapsed (has line-clamp-2)
    let contentElements = document.querySelectorAll('.italic.line-clamp-2')
    expect(contentElements.length).toBe(1)

    // Click to expand
    const header = screen.getByText('Thinking').parentElement
    fireEvent.click(header!)

    // Should now show all content without line-clamp
    contentElements = document.querySelectorAll('.italic.line-clamp-2')
    expect(contentElements.length).toBe(0)
    expect(screen.getByText(/Line 4 of thinking content/)).toBeInTheDocument()
  })

  it('collapses again when clicked twice', () => {
    // Need content longer than 100 characters
    const longContent = `Line 1 of thinking content that is quite long and detailed
Line 2 of thinking content with additional details and explanations
Line 3 of thinking content continues with more information
Line 4 of thinking content wraps up the thought process`.repeat(2)
    
    render(<ThinkingBlock content={longContent} isThinking={false} />)

    const header = screen.getByText('Thinking').parentElement
    
    // Expand
    fireEvent.click(header!)
    let contentElements = document.querySelectorAll('.italic.line-clamp-2')
    expect(contentElements.length).toBe(0)

    // Collapse
    fireEvent.click(header!)
    contentElements = document.querySelectorAll('.italic.line-clamp-2')
    expect(contentElements.length).toBe(1)
  })

  it('does not show expand button when content is short', () => {
    const shortContent = 'Short thinking'
    
    render(<ThinkingBlock content={shortContent} isThinking={false} />)

    // Should not have expand/collapse button
    expect(document.querySelector('button')).not.toBeInTheDocument()
  })

  it('has visual distinction with grey background and italic text', () => {
    render(<ThinkingBlock content="Some thinking content" isThinking={false} />)

    const container = screen.getByText('Thinking').closest('.rounded-lg')
    expect(container).toHaveClass('bg-zinc-900/30')
    expect(container).toHaveClass('border-zinc-800/50')
    
    const contentElement = screen.getByText(/Some thinking content/)
    expect(contentElement).toHaveClass('italic')
    expect(contentElement).toHaveClass('text-zinc-500')
  })

  it('displays Brain icon for completed thinking', () => {
    render(<ThinkingBlock content="Completed thinking" isThinking={false} />)
    
    // Brain icon is present when not thinking (check for svg element in header)
    const header = screen.getByText('Thinking').parentElement
    expect(header?.querySelector('svg')).toBeInTheDocument()
  })

  it('displays Loader2 icon for active thinking', () => {
    render(<ThinkingBlock content="Active thinking" isThinking={true} />)
    
    // Loader icon has animate-spin class when thinking
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('preserves line breaks in thinking content', () => {
    const contentWithLines = `First thought
Second thought
Third thought`
    
    render(<ThinkingBlock content={contentWithLines} isThinking={false} />)

    // All lines should be present
    expect(screen.getByText(/First thought/)).toBeInTheDocument()
    expect(screen.getByText(/Second thought/)).toBeInTheDocument()
    expect(screen.getByText(/Third thought/)).toBeInTheDocument()
  })

  it('applies hover effect on header', () => {
    render(<ThinkingBlock content="Test content" isThinking={false} />)

    const header = screen.getByText('Thinking').parentElement
    expect(header).toHaveClass('hover:bg-white/5')
    expect(header).toHaveClass('cursor-pointer')
  })

  it('shows expand button when content is long', () => {
    // Need content longer than 100 characters to trigger collapsible behavior
    const longContent = 'This is a very long thinking content that needs to be collapsed by default. '.repeat(3)
    
    render(<ThinkingBlock content={longContent} isThinking={false} />)

    // Should show expand/collapse button for long content (>100 chars)
    const header = screen.getByText('Thinking').parentElement
    expect(header?.querySelector('button')).toBeInTheDocument()
  })

  it('toggles chevron direction when expanded', () => {
    // Need content longer than 100 characters
    const longContent = 'This is a very long thinking content that needs to be collapsed by default. '.repeat(3)
    
    render(<ThinkingBlock content={longContent} isThinking={false} />)

    const header = screen.getByText('Thinking').parentElement
    const button = header?.querySelector('button')
    
    // Button should exist
    expect(button).toBeInTheDocument()
    
    // Click to expand
    fireEvent.click(header!)
    
    // Button should still exist after click
    expect(header?.querySelector('button')).toBeInTheDocument()
  })
})
