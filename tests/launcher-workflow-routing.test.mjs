import assert from 'node:assert/strict'
import test from 'node:test'

test('workflow command builder produces exact slash commands', async () => {
  const { buildWorkflowCommand } = await import('../dist/app/lib/launcher-workflow.js')

  assert.equal(
    buildWorkflowCommand('break_into_tasks', 'feature-launcher'),
    '/steward:break_into_tasks feature-launcher'
  )

  assert.equal(
    buildWorkflowCommand('complete_next_task', 'feature-launcher'),
    '/steward:complete_next_task feature-launcher'
  )

  assert.equal(
    buildWorkflowCommand('break_into_tasks', '  trim-me  '),
    '/steward:break_into_tasks trim-me'
  )
})

test('workflow dispatch guard blocks duplicate in-flight actions', async () => {
  const { canDispatchWorkflowAction } = await import('../dist/app/lib/launcher-workflow.js')

  let inFlightAction = null

  const firstAllowed = canDispatchWorkflowAction(inFlightAction)
  assert.equal(firstAllowed, true)
  if (firstAllowed) {
    inFlightAction = 'break_into_tasks'
  }

  assert.equal(canDispatchWorkflowAction(inFlightAction), false)

  inFlightAction = null
  assert.equal(canDispatchWorkflowAction(inFlightAction), true)
})
