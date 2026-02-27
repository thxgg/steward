import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

type PromptTextMessage = {
  role: 'user'
  content: {
    type: 'text'
    text: string
  }
}

function textMessage(text: string): PromptTextMessage {
  return {
    role: 'user',
    content: {
      type: 'text',
      text
    }
  }
}

function createPrdPrompt(featureRequest: string): string {
  return [
    'You are using Steward MCP to create a new Product Requirements Document (PRD).',
    '',
    'User request:',
    featureRequest,
    '',
    'Workflow:',
    '1. Clarify any major ambiguities with targeted questions before writing the PRD.',
    '2. Derive a kebab-case slug and create docs/prd/<slug>.md.',
    '3. Use this PRD structure at minimum:',
    '   - # PRD: <Feature Name>',
    '   - **Author:** Generated',
    '   - **Date:** <YYYY-MM-DD>',
    '   - **Status:** Draft',
    '   - Problem Statement, Users, Proposed Solution, Scope, Technical Considerations, Success Criteria, Risks.',
    '4. Before finishing, verify Steward repository registration with the execute tool:',
    '   const existing = await repos.list()',
    '   return existing.map((repo) => ({ id: repo.id, name: repo.name, path: repo.path }))',
    '   If no repository is registered, register this repository with repos.add(<absolute_path>, <optional_name>).',
    '5. Do not generate tasks in this step.',
    '6. End with:',
    '   - created PRD path',
    '   - chosen slug',
    '   - key product decisions and open questions',
    '   - recommended next MCP prompt: /<your-mcp-server-prefix>:break_into_tasks <slug> (autocomplete may show an extra :mcp suffix).'
  ].join('\n')
}

function breakIntoTasksPrompt(prdSlug?: string): string {
  const resolvedInput = typeof prdSlug === 'string' ? prdSlug.trim() : ''

  return [
    'You are converting a PRD into structured Steward task state.',
    '',
    `PRD slug input: ${resolvedInput || '<auto-resolve>'}`,
    '',
    'Workflow:',
    '1. Resolve repository and PRD slug before writing anything:',
    '   - Resolve repo with execute tool: const repo = await repos.current().',
    '   - If slug input is present, use it as resolvedSlug.',
    '   - If slug input is missing, list PRDs: const prdList = await prds.list(repo.id).',
    '   - Auto-pick resolvedSlug deterministically:',
    '     a) prefer PRDs with hasState=false, newest modifiedAt first, then slug ascending',
    '     b) otherwise pick newest modifiedAt, then slug ascending',
    '   - If no PRDs exist, stop and ask user to run create_prd first.',
    '2. Load docs/prd/<resolvedSlug>.md. If missing, list available PRDs and stop with a clear correction.',
    '3. Update PRD status from Draft to Approved in the markdown file.',
    '4. Build tasks JSON with this shape:',
    '   { prd: { name, source, createdAt }, tasks: [{ id, category, title, description, steps, passes, dependencies, priority, status }] }',
    '5. Use these category values only: setup, feature, integration, testing, documentation.',
    '6. Use these priority values only: critical, high, medium, low.',
    '7. Set every generated task status to pending and make passes an array of testable criteria.',
    '8. Build progress JSON with this shape:',
    '   { prdName, totalTasks, completed, inProgress, blocked, startedAt, lastUpdated, patterns, taskLogs }',
    '   Initialize with completed=0, inProgress=0, blocked=0, startedAt=null, patterns=[], taskLogs=[].',
    '9. Persist state through execute tool:',
    '   await state.upsertCurrent(resolvedSlug, { tasks: tasksJson, progress: progressJson })',
    '   return await state.getCurrent(resolvedSlug)',
    '10. Report task count, category breakdown, critical path, resolvedSlug, and recommended next MCP prompt:',
    '   /<your-mcp-server-prefix>:complete_next_task <resolvedSlug> (autocomplete may show an extra :mcp suffix).'
  ].join('\n')
}

function completeNextTaskPrompt(prdSlug?: string): string {
  const resolvedInput = typeof prdSlug === 'string' ? prdSlug.trim() : ''

  return [
    'You are completing the next PRD task with Steward state tracking and commits.',
    '',
    `PRD slug input: ${resolvedInput || '<auto-resolve>'}`,
    '',
    'Workflow:',
    '1. Resolve repository and PRD slug before any task updates:',
    '   - Resolve repo with execute tool: const repo = await repos.current().',
    '   - If slug input is present, use it as resolvedSlug.',
    '   - If slug input is missing, list PRDs: const prdList = await prds.list(repo.id).',
    '   - Build actionable candidates where hasState=true and completedCount < taskCount.',
    '   - Auto-pick resolvedSlug as the latest actionable candidate (modifiedAt desc, then slug asc).',
    '   - If no actionable candidates exist, fall back to latest PRD with hasState=true, then latest PRD overall.',
    '   - If no PRD exists, stop and ask user to run create_prd first.',
    '2. Load PRD state with execute tool: state.getCurrent(resolvedSlug).',
    '   If tasks are missing, stop and instruct to run /<your-mcp-server-prefix>:break_into_tasks <resolvedSlug>.',
    '3. Select the next task:',
    '   - first task with status=in_progress, otherwise',
    '   - first pending task whose dependencies are all completed.',
    '4. Immediately mark the task in progress and save with state.upsertCurrent:',
    '   - task.status = in_progress',
    '   - task.startedAt = ISO timestamp (if absent)',
    '   - progress.inProgress updated',
    '   - progress.lastUpdated updated',
    '   - taskLogs entry exists with { taskId, status: in_progress, startedAt }',
    '5. Implement only this task in repository files.',
    '6. Run validation loops relevant to the project before commit (typecheck, tests, lint, format/build where applicable).',
    '7. Commit requirements (mandatory when task-related files changed):',
    '   - Stage only task-related files (do not stage unrelated work).',
    '   - Create at least one commit before finishing when task-related changes exist.',
    '   - Use a one-line conventional commit subject (single -m line, no body).',
    '   - Do not include trailers or footers, especially no Co-authored-by.',
    '   - Prefer execute tool git.commitIfChanged(repo.id, message, { paths: taskRelatedFiles }).',
    '   - If task-related changes exist, commit result must be committed=true before finishing.',
    '   - If commit fails due to checks/hooks, fix issues and create a new commit.',
    '   - Verify task-related files are not left uncommitted before final output.',
    '8. Capture commit SHAs and update taskLogs[].commits (use { sha, repo } objects for nested repos when needed).',
    '9. Mark task completed and save with state.upsertCurrent:',
    '   - task.status = completed',
    '   - task.completedAt = ISO timestamp',
    '   - progress.completed / progress.inProgress / progress.lastUpdated updated',
    '   - taskLogs entry updated with completedAt, implemented, filesChanged, learnings, commits',
    '10. If all tasks are completed, output exactly: <tasks>COMPLETE</tasks>.',
    '11. Report what changed, resolvedSlug, which commit(s) were created, and the next pending task if any.'
  ].join('\n')
}

export function registerStewardPrompts(server: McpServer): void {
  server.registerPrompt(
    'create_prd',
    {
      title: 'Create PRD',
      description: 'Create a PRD markdown document and prepare Steward workflow context.',
      argsSchema: {
        feature_request: z.string().describe('Feature request, idea, or problem statement for the PRD')
      }
    },
    async (args: { feature_request: string }) => ({
      description: 'Guided workflow for creating a PRD file.',
      messages: [textMessage(createPrdPrompt(args.feature_request))]
    })
  )

  server.registerPrompt(
    'break_into_tasks',
    {
      title: 'Break Into Tasks',
      description: 'Convert a PRD into tasks.json/progress.json style state and save it.',
      argsSchema: {
        prd_slug: z.string().optional().describe('Optional PRD slug (filename in docs/prd without .md). Auto-resolved when omitted.')
      }
    },
    async (args: { prd_slug?: string }) => ({
      description: 'Workflow for converting an approved PRD into task state.',
      messages: [textMessage(breakIntoTasksPrompt(args.prd_slug))]
    })
  )

  server.registerPrompt(
    'complete_next_task',
    {
      title: 'Complete Next Task',
      description: 'Complete the next in-progress/pending task and persist state updates.',
      argsSchema: {
        prd_slug: z.string().optional().describe('Optional PRD slug whose next task should be completed. Auto-resolved when omitted.')
      }
    },
    async (args: { prd_slug?: string }) => ({
      description: 'Workflow for task execution, verification, commit capture, and state persistence.',
      messages: [textMessage(completeNextTaskPrompt(args.prd_slug))]
    })
  )
}
