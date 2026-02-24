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
    '   - recommended next command: /prd:break_into_tasks <slug> (shown as :mcp in autocomplete).'
  ].join('\n')
}

function breakIntoTasksPrompt(prdSlug: string): string {
  return [
    'You are converting a PRD into structured Steward task state.',
    '',
    'PRD slug:',
    prdSlug,
    '',
    'Workflow:',
    '1. Load docs/prd/<slug>.md. If not found, list available PRDs and stop with a clear correction.',
    '2. Update PRD status from Draft to Approved in the markdown file.',
    '3. Build tasks JSON with this shape:',
    '   { prd: { name, source, createdAt }, tasks: [{ id, category, title, description, steps, passes, dependencies, priority, status }] }',
    '4. Use these category values only: setup, feature, integration, testing, documentation.',
    '5. Use these priority values only: critical, high, medium, low.',
    '6. Set every generated task status to pending and make passes an array of testable criteria.',
    '7. Build progress JSON with this shape:',
    '   { prdName, totalTasks, completed, inProgress, blocked, startedAt, lastUpdated, patterns, taskLogs }',
    '   Initialize with completed=0, inProgress=0, blocked=0, startedAt=null, patterns=[], taskLogs=[].',
    '8. Persist state through execute tool:',
    `   await state.upsertCurrent("${prdSlug}", { tasks: <tasksJson>, progress: <progressJson> })`,
    `   return await state.getCurrent("${prdSlug}")`,
    '9. Report task count, category breakdown, critical path, and recommended next command:',
    `   /prd:complete_next_task ${prdSlug} (shown as :mcp in autocomplete).`
  ].join('\n')
}

function completeNextTaskPrompt(prdSlug: string): string {
  return [
    'You are completing the next PRD task with Steward state tracking and commits.',
    '',
    'PRD slug:',
    prdSlug,
    '',
    'Workflow:',
    `1. Load PRD state using execute tool: state.getCurrent("${prdSlug}").`,
    `   If tasks are missing, stop and instruct to run /prd:break_into_tasks ${prdSlug}.`,
    '2. Select the next task:',
    '   - first task with status=in_progress, otherwise',
    '   - first pending task whose dependencies are all completed.',
    '3. Immediately mark the task in progress and save with state.upsertCurrent:',
    '   - task.status = in_progress',
    '   - task.startedAt = ISO timestamp (if absent)',
    '   - progress.inProgress updated',
    '   - progress.lastUpdated updated',
    '   - taskLogs entry exists with { taskId, status: in_progress, startedAt }',
    '4. Implement only this task in repository files.',
    '5. Run validation loops relevant to the project before commit (typecheck, tests, lint, format/build where applicable).',
    '6. Commit task-related changes with a concise conventional commit message.',
    '7. Capture commit SHAs and update taskLogs[].commits (use { sha, repo } objects for nested repos when needed).',
    '8. Mark task completed and save with state.upsertCurrent:',
    '   - task.status = completed',
    '   - task.completedAt = ISO timestamp',
    '   - progress.completed / progress.inProgress / progress.lastUpdated updated',
    '   - taskLogs entry updated with completedAt, implemented, filesChanged, learnings, commits',
    '9. If all tasks are completed, output exactly: <tasks>COMPLETE</tasks>.',
    '10. Report what changed, which commit(s) were created, and the next pending task if any.'
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
    async ({ feature_request }) => ({
      description: 'Guided workflow for creating a PRD file.',
      messages: [textMessage(createPrdPrompt(feature_request))]
    })
  )

  server.registerPrompt(
    'break_into_tasks',
    {
      title: 'Break Into Tasks',
      description: 'Convert a PRD into tasks.json/progress.json style state and save it.',
      argsSchema: {
        prd_slug: z.string().describe('PRD slug, usually the filename in docs/prd without .md')
      }
    },
    async ({ prd_slug }) => ({
      description: 'Workflow for converting an approved PRD into task state.',
      messages: [textMessage(breakIntoTasksPrompt(prd_slug))]
    })
  )

  server.registerPrompt(
    'complete_next_task',
    {
      title: 'Complete Next Task',
      description: 'Complete the next in-progress/pending task and persist state updates.',
      argsSchema: {
        prd_slug: z.string().describe('PRD slug whose next task should be completed')
      }
    },
    async ({ prd_slug }) => ({
      description: 'Workflow for task execution, verification, commit capture, and state persistence.',
      messages: [textMessage(completeNextTaskPrompt(prd_slug))]
    })
  )
}
