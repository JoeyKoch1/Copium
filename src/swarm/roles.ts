import type { SwarmAgentRole } from './types';

/**
 * The default explorer -> coder -> reviewer pipeline used by both the
 * `/swarm` command (engine.ts) and the `spawnSwarm` tool (agent/tools.ts).
 * Defined once here so the two call sites can't drift out of sync.
 */
export const DEFAULT_SWARM_ROLES: SwarmAgentRole[] = [
  {
    id: 'explorer',
    name: 'Explorer',
    description: 'Scans codebase and gathers context',
    systemPrompt:
      'You are an explorer agent. Your job is to scan the codebase, find relevant files, and gather context. Be thorough and report file paths and key findings.',
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Implements changes',
    systemPrompt:
      'You are a coder agent. Your job is to implement changes based on the gathered context. Write clean, working code.',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews changes for correctness',
    systemPrompt:
      'You are a reviewer agent. Your job is to review code changes for correctness, security, and best practices. Report issues clearly.',
  },
];
