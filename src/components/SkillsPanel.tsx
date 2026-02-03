import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, BookOpen, Terminal, GitBranch, FileCode, MessageSquare, Zap } from 'lucide-react';
import clsx from 'clsx';

interface Skill {
  name: string;
  description: string;
  source: 'project' | 'global';
  permission: string;
}

export function SkillsPanel() {
  const { workspacePath } = useStore();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  useEffect(() => {
    if (workspacePath) {
      loadSkills();
    }
  }, [workspacePath]);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const result = await invoke<{ skills: Skill[]; count: number }>('list_skills', {
        workspacePath
      });
      setSkills(result.skills || []);
    } catch (error) {
      console.error('Failed to load skills:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSkill = async (skillName: string) => {
    // Emit event to trigger skill in chat
    window.dispatchEvent(new CustomEvent('load-skill', { detail: skillName }));
  };

  const filteredSkills = skills.filter(skill =>
    skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSkillIcon = (name: string) => {
    if (name.includes('git')) return <GitBranch className="w-4 h-4" />;
    if (name.includes('code') || name.includes('review')) return <FileCode className="w-4 h-4" />;
    if (name.includes('doc')) return <BookOpen className="w-4 h-4" />;
    if (name.includes('test')) return <Terminal className="w-4 h-4" />;
    if (name.includes('chat') || name.includes('message')) return <MessageSquare className="w-4 h-4" />;
    return <Sparkles className="w-4 h-4" />;
  };

  if (!workspacePath) {
    return (
      <div className="p-4 text-sm text-zinc-500 text-center">
        Select a workspace to view skills
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-3 h-3" />
            Skills ({skills.length})
          </h3>
          <button
            onClick={loadSkills}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {loading ? '...' : '↻'}
          </button>
        </div>
        
        {/* Search */}
        <input
          type="text"
          placeholder="Search skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded 
                     text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-[var(--accent)]"
        />
      </div>

      {/* Skills List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading ? (
          <div className="text-center text-xs text-zinc-500 py-4">Loading skills...</div>
        ) : filteredSkills.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-4">
            {searchQuery ? 'No skills match your search' : 'No skills found'}
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <div
              key={skill.name}
              className={clsx(
                "group p-3 rounded-lg border transition-all cursor-pointer",
                selectedSkill?.name === skill.name
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-zinc-600"
              )}
              onClick={() => setSelectedSkill(skill)}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 text-zinc-400">
                  {getSkillIcon(skill.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-zinc-200 truncate">
                      {skill.name}
                    </h4>
                    <span className={clsx(
                      "text-[10px] px-1.5 py-0.5 rounded",
                      skill.source === 'project' 
                        ? "bg-blue-500/20 text-blue-400" 
                        : "bg-purple-500/20 text-purple-400"
                    )}>
                      {skill.source}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                    {skill.description}
                  </p>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadSkill(skill.name);
                      }}
                      disabled={skill.permission === 'requires_confirmation'}
                      className={clsx(
                        "text-xs px-2 py-1 rounded transition-colors",
                        skill.permission === 'requires_confirmation'
                          ? "bg-yellow-500/20 text-yellow-400 cursor-not-allowed"
                          : "bg-[var(--accent)] text-white hover:opacity-90"
                      )}
                    >
                      {skill.permission === 'requires_confirmation' ? 'Confirm Required' : 'Load'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[var(--border)] text-xs text-zinc-600">
        <p>Create skills in .anvil/skills/</p>
      </div>
    </div>
  );
}
