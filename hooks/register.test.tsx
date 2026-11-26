import { expect, test } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'

const ANSWER = { isAnswered: true, text: 'CLEAN REQUEST', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
const LONG = 'okay so like I want you to go and look at the hooks because they are all the same thing every day and the graphics look like clip art so fix that please and send me some'
const send = ($: any, text: string, kind: PromptOrigin['kind'] = 'bridge', extra = {}) => $.prompt.submit({ text, wait: false, origin: { kind } as PromptOrigin, ...extra })

function setup(on: any, answer: unknown = ANSWER, draft = '') {
  const asked: string[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('prompt.read', () => ({ value: { text: draft, cursor: 0 } }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text, context: e.context, origin: e.origin }))
  on('model.complete', (_: unknown, e: any) => { asked.push(String(e.prompt) + JSON.stringify(e)); return { value: answer } })
  return asked
}

const tap = async ($: any) => { const ui = await $.ui.mount({ plugin: 'master-prompt', surface: 'mobile', component: 'AbovePrompt', props: { hasSurvey: false } } as any); await ui.press({ key: 'master' }); await ui.unmount() }

test('tap Master prompt, send: the message is rewritten once, the original kept for Claude', async ($, on) => {
  const asked = setup(on)
  await tap($)
  const r = await send($, LONG)
  expect(r.text).toBe('CLEAN REQUEST')
  expect((r.context ?? []).join(' ')).toContain(LONG)
  expect(asked[0]).toContain(LONG)
  expect((await send($, LONG)).text).toBe(LONG) // one message only
})

test('without the tap, nothing is rewritten', async ($, on) => {
  const asked = setup(on)
  expect((await send($, LONG)).text).toBe(LONG)
  expect(asked.length).toBe(0)
})

test('tapping twice turns it back off', async ($, on) => {
  setup(on)
  await tap($); await tap($)
  expect((await send($, LONG)).text).toBe(LONG)
})

test('works from the terminal too', async ($, on) => {
  setup(on)
  await tap($)
  expect((await send($, LONG, 'composer')).text).toBe('CLEAN REQUEST')
})

test('a short message after the tap is rewritten too; plain short replies are not', async ($, on) => {
  const asked = setup(on)
  await tap($)
  expect((await send($, 'fix v28')).text).toBe('CLEAN REQUEST')
  asked.length = 0
  for (const t of ['deploy', 'yes', 'merged everything', 'ok go ahead and send it']) expect((await send($, t)).text).toBe(t)
  expect(asked.length).toBe(0)
})

test('"mp" or "master prompt" forces a rewrite of a short one', async ($, on) => {
  const asked = setup(on)
  expect((await send($, 'mp fix v28 stutter')).text).toBe('CLEAN REQUEST')
  expect((await send($, 'Master prompt: fix v29')).text).toBe('CLEAN REQUEST')
  expect(asked[0]).toContain('fix v28 stutter')
  expect(asked[0]).not.toContain('mp fix')
})

test('words that only start with mp are not a trigger', async ($, on) => {
  setup(on)
  expect((await send($, 'mpg numbers look fine')).text).toBe('mpg numbers look fine')
})

test('notifications, other sessions, scheduled tasks and plugins are never rewritten', async ($, on) => {
  const asked = setup(on)
  await tap($)
  for (const k of ['task-notification', 'peer', 'scheduled-trigger', 'plugin', 'sdk'] as const) expect((await send($, LONG, k)).text).toBe(LONG)
  expect(asked.length).toBe(0)
})

test('if the rewrite fails, the message goes through in his own words', async ($, on) => {
  setup(on, { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' })
  await tap($)
  const r = await send($, LONG)
  expect(r.text).toBe(LONG)
  expect((r.context ?? []).join(' ')).toContain('could not rewrite')
})

test('the button shows when it is on', async ($, on) => {
  setup(on)
  await tap($)
  const ui = await $.ui.mount({ plugin: 'master-prompt', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false } } as any)
  expect(JSON.stringify(await ui.find({ type: 'Button' }))).toContain('ON for your next message')
  await ui.unmount()
})

test('where the app shares the draft, the tap rewrites the box in place', async ($, on) => {
  const filled: string[] = []
  setup(on, ANSWER, LONG)
  on('prompt.fill', (_: unknown, e: any) => { filled.push(e.text); return { isFilled: true, text: e.text, cursor: e.text.length } })
  await tap($)
  expect(filled).toEqual(['CLEAN REQUEST'])
  expect((await send($, 'CLEAN REQUEST')).text).toBe('CLEAN REQUEST') // not rewritten twice
})

test('the rewrite is told to expand and keep every detail, never shorten', async ($, on) => {
  const asked = setup(on)
  await tap($)
  await send($, LONG)
  expect(asked[0]).toContain('never shorten')
  expect(asked[0]).toContain('WHAT TO DO (step by step)')
  expect(asked[0]).toContain('"maxTokens":3500')
})
