import { useMemo } from 'react';
import { Message } from '../types';
import { ActionCard, ThinkingBlock, MessageCard } from './ActivityCards';

interface ActivityItem {
  id: string;
  type: 'message' | 'thinking' | 'action' | 'tool';
  role?: 'user' | 'assistant';
  content: string;
  actionType?: 'read' | 'write' | 'execute' | 'search' | 'edit' | 'generic';
  actionTitle?: string;
  actionDescription?: string;
  actionContent?: string;
  actionStatus?: 'pending' | 'running' | 'success' | 'error';
  isThinking?: boolean;
  timestamp?: string;
}

interface ActivityStreamProps {
  messages: Message[];
  isLoading?: boolean;
}

export function ActivityStream({ messages, isLoading }: ActivityStreamProps) {
  // Parse messages into activity items
  const activities = useMemo(() => {
    const items: ActivityItem[] = [];
    
    messages.forEach((msg, idx) => {
      const id = `activity-${idx}`;
      
      if (msg.role === 'User') {
        items.push({
          id,
          type: 'message',
          role: 'user',
          content: msg.content || '',
          timestamp: new Date().toLocaleTimeString()
        });
      } else if (msg.role === 'Assistant') {
        const content = msg.content || '';
        
        // Check if this is a thinking block by looking for thinking keywords or patterns
        const thinkingPatterns = [
          /^(?:thinking|analyzing|considering|pondering|reflecting)/i,
          /(?:let me think|i'll analyze|considering options)/i,
          /(?:step by step|breaking down|evaluating)/i
        ];
        
        const isThinkingContent = thinkingPatterns.some(pattern => pattern.test(content));
        
        if (isThinkingContent) {
          items.push({
            id,
            type: 'thinking',
            content: content,
            isThinking: false
          });
        }
        
        // Parse tool executions
        const toolPattern = /> Executing tool: `([^`]+)`[\s\S]*?(?:> Result:\s*)?```\n?([\s\S]*?)```/g;
        let match;
        
        while ((match = toolPattern.exec(content)) !== null) {
          const toolName = match[1];
          const result = match[2];
          
          // Determine action type and status
          let actionType: ActivityItem['actionType'] = 'generic';
          let actionStatus: ActivityItem['actionStatus'] = 'success';
          
          if (toolName.includes('read')) {
            actionType = 'read';
          } else if (toolName.includes('write')) {
            actionType = 'write';
          } else if (toolName.includes('bash') || toolName.includes('exec')) {
            actionType = 'execute';
          } else if (toolName.includes('search')) {
            actionType = 'search';
          } else if (toolName.includes('edit')) {
            actionType = 'edit';
          }
          
          if (result.toLowerCase().includes('error') || result.toLowerCase().includes('denied')) {
            actionStatus = 'error';
          }
          
          items.push({
            id: `${id}-tool-${match.index}`,
            type: 'action',
            actionType,
            actionTitle: `${toolName}`,
            actionDescription: `Executing ${toolName}`,
            actionContent: result,
            actionStatus,
            content: ''
          });
        }
        
        // Add remaining content as message (excluding tool patterns)
        const cleanContent = content.replace(toolPattern, '').trim();
        if (cleanContent) {
          items.push({
            id: `${id}-msg`,
            type: 'message',
            role: 'assistant',
            content: cleanContent,
            timestamp: new Date().toLocaleTimeString()
          });
        }
      }
    });
    
    return items;
  }, [messages]);

  if (activities.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Activity Items */}
      <div className="space-y-3">
        {activities.map((activity) => {
          switch (activity.type) {
            case 'message':
              return (
                <MessageCard
                  key={activity.id}
                  role={activity.role!}
                  content={activity.content}
                  timestamp={activity.timestamp}
                />
              );
              
            case 'thinking':
              return (
                <ThinkingBlock
                  key={activity.id}
                  content={activity.content}
                  isThinking={activity.isThinking}
                />
              );
              
            case 'action':
              return (
                <ActionCard
                  key={activity.id}
                  type={activity.actionType!}
                  title={activity.actionTitle!}
                  description={activity.actionDescription}
                  content={activity.actionContent}
                  status={activity.actionStatus!}
                />
              );
              
            default:
              return null;
          }
        })}
      </div>

      {/* Loading / Thinking Indicator - only show if no recent thinking content */}
      {isLoading && !activities.some(a => a.type === 'thinking') && (
        <ThinkingBlock 
          content="Agent is analyzing your request and preparing a response..." 
          isThinking={true} 
        />
      )}
    </div>
  );
}

export default ActivityStream;
