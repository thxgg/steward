import assert from 'node:assert/strict'
import test from 'node:test'

function createPromptRegistry() {
  const prompts = new Map()

  return {
    prompts,
    server: {
      registerPrompt(name, config, handler) {
        prompts.set(name, { config, handler })
      }
    }
  }
}

test('MCP prompts support optional slug auto-resolution and strict commit guidance', async () => {
  const { registerStewardPrompts } = await import('../dist/host/src/prompts.js')
  const { prompts, server } = createPromptRegistry()

  registerStewardPrompts(server)

  const breakPrompt = prompts.get('break_into_tasks')
  assert.ok(breakPrompt)
  assert.equal(breakPrompt.config.argsSchema.prd_slug.safeParse(undefined).success, true)

  const breakResponse = await breakPrompt.handler({})
  const breakText = breakResponse.messages[0].content.text
  assert.match(breakText, /PRD slug input: <auto-resolve>/)
  assert.match(breakText, /Auto-pick resolvedSlug deterministically/)

  const completePrompt = prompts.get('complete_next_task')
  assert.ok(completePrompt)
  assert.equal(completePrompt.config.argsSchema.prd_slug.safeParse(undefined).success, true)

  const completeResponse = await completePrompt.handler({})
  const completeText = completeResponse.messages[0].content.text
  assert.match(completeText, /latest actionable candidate/i)
  assert.match(completeText, /one-line conventional commit subject/i)
  assert.match(completeText, /no Co-authored-by/i)
})
