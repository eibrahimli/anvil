import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { X, HelpCircle } from 'lucide-react';
import clsx from 'clsx';

interface QuestionOption {
  label: string;
  description: string;
  value: string;
}

interface Question {
  id: string;
  header: string;
  question: string;
  options: QuestionOption[];
  multiple: boolean;
}

interface QuestionRequest {
  id: string;
  questions: Question[];
}

interface QuestionAnswers {
  [questionId: string]: string | string[];
}

export function QuestionModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [request, setRequest] = useState<QuestionRequest | null>(null);
  const [answers, setAnswers] = useState<QuestionAnswers>({});
  const [customAnswers, setCustomAnswers] = useState<{[key: string]: string}>({});

  useEffect(() => {
    const unlisten = listen<QuestionRequest>('agent:question', (event) => {
      setRequest(event.payload);
      setAnswers({});
      setCustomAnswers({});
      setIsOpen(true);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const handleOptionSelect = (questionId: string, value: string, multiple: boolean) => {
    setAnswers(prev => {
      if (multiple) {
        const current = (prev[questionId] as string[]) || [];
        if (current.includes(value)) {
          return { ...prev, [questionId]: current.filter(v => v !== value) };
        } else {
          return { ...prev, [questionId]: [...current, value] };
        }
      } else {
        return { ...prev, [questionId]: value };
      }
    });
  };

  const handleCustomAnswer = (questionId: string, value: string) => {
    setCustomAnswers(prev => ({ ...prev, [questionId]: value }));
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = async () => {
    if (!request) return;

    // Check if all questions have answers
    const unanswered = request.questions.filter(q => !answers[q.id]);
    if (unanswered.length > 0) {
      return; // Don't submit if not all questions answered
    }

    try {
      console.log('Submitting answer for question:', request.id, answers);
      await invoke('resolve_question', {
        questionId: request.id,
        answers: answers
      });
      console.log('Answer submitted successfully');
      setIsOpen(false);
      setRequest(null);
    } catch (error) {
      console.error('Failed to submit answer:', error);
    }
  };

  const handleCancel = async () => {
    if (!request) return;

    // Submit cancellation
    try {
      await invoke('resolve_question', {
        questionId: request.id,
        answers: { cancelled: true }
      });
      setIsOpen(false);
      setRequest(null);
    } catch (error) {
      console.error('Failed to cancel:', error);
    }
  };

  if (!isOpen || !request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border)] bg-[var(--bg-base)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)]">
              <HelpCircle size={20} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                Agent Needs Your Input
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                {request.questions.length} question{request.questions.length !== 1 ? 's' : ''} • Answer to continue
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-[var(--bg-elevated)] rounded-lg transition-colors text-[var(--text-secondary)]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Questions */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {request.questions.map((question, index) => (
            <div key={question.id} className="space-y-4">
              {/* Question Header */}
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-bold flex items-center justify-center">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <span className="text-xs font-bold text-[var(--accent)] uppercase tracking-wider">
                    {question.header}
                  </span>
                  <p className="text-sm text-[var(--text-primary)] mt-1 leading-relaxed">
                    {question.question}
                  </p>
                </div>
              </div>

              {/* Options */}
              <div className="ml-9 space-y-2">
                {question.options.map((option) => {
                  const isSelected = question.multiple
                    ? ((answers[question.id] as string[]) || []).includes(option.value)
                    : answers[question.id] === option.value;

                  return (
                    <button
                      key={option.value}
                      onClick={() => handleOptionSelect(question.id, option.value, question.multiple)}
                      className={clsx(
                        "w-full text-left p-4 rounded-xl border-2 transition-all",
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--accent)]/10"
                          : "border-[var(--border)] hover:border-[var(--accent)]/50 hover:bg-[var(--bg-elevated)]"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={clsx(
                          "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                          isSelected
                            ? "border-[var(--accent)] bg-[var(--accent)]"
                            : "border-[var(--border)]"
                        )}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={clsx(
                            "font-medium text-sm",
                            isSelected ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                          )}>
                            {option.label}
                          </p>
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            {option.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Custom Answer Option */}
                <div className="pt-2">
                  <p className="text-xs text-[var(--text-secondary)] mb-2">Or type your own answer:</p>
                  <input
                    type="text"
                    value={customAnswers[question.id] || ''}
                    onChange={(e) => handleCustomAnswer(question.id, e.target.value)}
                    placeholder="Type your answer..."
                    className="w-full px-4 py-3 bg-[var(--bg-base)] border border-[var(--border)] rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-[var(--border)] bg-[var(--bg-base)]">
          <button
            onClick={handleCancel}
            className="px-5 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={request.questions.some(q => !answers[q.id])}
            className={clsx(
              "px-5 py-2.5 text-sm font-medium rounded-xl transition-all",
              request.questions.some(q => !answers[q.id])
                ? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-not-allowed"
                : "bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 active:scale-95"
            )}
          >
            Submit Answer{request.questions.length > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
