import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Busy, Meter } from '../types'

// From a TikTok about Claude mods: a Master prompt button that rewrites the draft, a usage meter
// (5-hour and weekly limits + the chat's context window), and the prompt cache shown in the chat (it stays warm
// for 60 minutes after a reply; past that, the next message re-reads the whole chat, which costs more and is slower).
const busy = atom({ plugin: 'master-prompt', key: 'busy' } as const, 'idle' as Busy)
const undo = atom({ plugin: 'master-prompt', key: 'undo' } as const, null as string | null)
const meter = atom({ plugin: 'master-prompt', key: 'meter' } as const, null as Meter | null)
const lastReplyAt = atom({ plugin: 'master-prompt', key: 'lastReplyAt' } as const, null as number | null)
const tick = atom({ plugin: 'master-prompt', key: 'tick' } as const, 0)
// Tap-only: the app won't let a button read or change the draft,
// so the button arms the NEXT message instead: type or dictate, tap Master prompt, send. That message is rewritten on
// its way in. Tap again to cancel. "mp" at the start still works too.
const armed = atom({ plugin: 'master-prompt', key: 'armed' } as const, false)

const CACHE_MS = 60 * 60 * 1000
// Low cost: Haiku at low effort with the rules cached; it runs only on a tap
// or "mp", never on its own, and the meter and cache timer make no model calls at all.
const PERSON = ['composer', 'bridge', 'unclassified']

const RULES = `You turn a rough message the user is about to send to their AI coding assistant into a complete, detailed brief, the way an expert writes a long prompt for ChatGPT or Claude. The user often dictates by voice, so the draft can ramble, repeat itself, have typos or swear.

The user's rule: never shorten the message, because a shorter prompt gives the assistant less to work with. EXPAND it: explain everything better, break it into clear steps, and make it more informative. The result is always longer and more detailed than the draft.

Write the brief in this shape (use the headings; skip one only when it truly has nothing):
GOAL: one or two sentences on what they want and why.
CONTEXT: everything they said or clearly implied about the situation, what exists now, and what is wrong with it. Keep their key phrases in quotes where they carry meaning.
WHAT TO DO (step by step): numbered steps in a sensible order, each one concrete and actionable, covering every separate thing they asked for. Break big asks into smaller steps.
REQUIREMENTS: every detail, constraint, preference and rule they stated (names, numbers, files, tabs, versions, "don't deploy yet", "send it to me first", how strongly they feel), as bullets.
QUALITY BAR: what "good" looks like and what to avoid, from their words.
DELIVERABLES / DONE WHEN: exactly what they should get back and how to tell it is finished (for example: tested, screenshots, a link, a summary).
OPEN QUESTIONS: only real ambiguities that would change the work.

Rules:
- Keep EVERY detail, example, complaint, reason and nuance. Nothing may be lost or merged away.
- You may spell out steps and checks that clearly follow from their words; mark anything you add that they did not say with "(implied)". Never invent new goals, features, opinions or decisions they did not ask for.
- Write in first person as the user, talking to their assistant. Plain words, no em dashes, no greeting or sign-off, no commentary about the rewrite.
Return only the brief.`

type Engine = EngineInterface

async function rewrite($: Engine) {
  if ((await read($, busy)) === 'working') return
  const { text } = await $.prompt.read()
  const draft = text.trim()
  if (!draft) {
    // the phone and web apps keep the draft on the device, so the button can't always see it: say how else to do it
    $.ui.toast('The app did not share your draft with the button. Start your message with "mp" and send it instead')
    return
  }
  await update($, busy, () => 'working' as Busy)
  try {
    const r = await $.model.complete({ model: 'haiku', effort: 'medium', system: [{ text: RULES, cache: true }], prompt: `The draft:\n\n${draft}`, maxTokens: 3500, timeoutMs: 45000 })
    if (!r.isAnswered || !r.text.trim()) {
      $.ui.toast(`Couldn't rewrite it (${r.isAnswered ? 'empty reply' : r.reason}), your draft is untouched`)
      return
    }
    const f = await $.prompt.fill({ text: r.text.trim(), mode: 'replace' })
    if (!f.isFilled) {
      $.ui.toast('The app would not let the button change your draft. Start your message with "mp" and send it instead')
      return
    }
    await update($, undo, () => draft)
    $.ui.toast('Rewritten. Check it, then send')
  } finally {
    await update($, busy, () => 'idle' as Busy)
  }
}

async function putBack($: Engine) {
  const before = await read($, undo)
  if (before === null) return
  await $.prompt.fill({ text: before, mode: 'replace' })
  await update($, undo, () => null)
}

// Where the app shares the draft (the terminal and the desktop app running on his own computer), the tap rewrites the
// box in place like the TikTok. Where it doesn't (claude.ai web and the phone app: the draft stays on the device), the
// tap arms the next message instead.
async function tap($: Engine) {
  if (!(await read($, armed))) {
    const { text } = await $.prompt.read()
    if (text.trim()) return rewrite($)
  }
  return toggle($)
}

async function toggle($: Engine) {
  const on = !(await read($, armed))
  await update($, armed, () => on)
  $.ui.toast(on ? 'Master prompt is on: send your message and it gets rewritten' : 'Master prompt off')
}

const pct = (n: number | null) => (n === null ? '?' : `${Math.round(n)}%`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // redraw once a minute so the cache countdown stays true
    void (async () => {
      for (;;) {
        await $.clock.sleep(60_000)
        await update($, tick, (n) => n + 1)
      }
    })()
    return r
  })

  on('session.measure', async ($, e, next) => {
    const find = (k: string) => e.rateLimits.find((x) => x.kind === k)
    const five = find('five_hour'), week = find('seven_day')
    await update($, meter, () => ({
      fiveHour: five ? five.percentUsed : null,
      week: week ? week.percentUsed : null,
      weekResets: week && week.resetsAt ? week.resetsAt : null,
      ctx: e.context.percent ?? null,
    }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, lastReplyAt, () => at)
    return next(e)
  })

  // The way that works everywhere (the button can't read the draft in the web and phone apps): start the message with "mp"
  // (or say "master prompt" first) and send. The message is rewritten on its way in; the original rides along as
  // context so Claude can show the rewrite and check nothing was lost.
  on('prompt.submit', async ($, e, next) => {
    await update($, undo, () => null)
    // only what the user types or dictates: the app's Enter (composer), the phone / web app (bridge), or unstamped; never a
    // notification, a scheduled task, another session, a plugin or a slash command
    if (e.command || e.isMeta || !PERSON.includes(e.origin?.kind ?? 'unclassified')) return next(e)
    const m = /^\s*(?:mp\b|master\s*prompt\b)[\s:,.-]*/i.exec(e.text)
    const isArmed = await read($, armed)
    const draft = (m ? e.text.slice(m[0].length) : e.text).trim()
    if (!draft || (!m && !isArmed)) return next(e)
    await update($, armed, () => false)
    const r = await $.model.complete({ model: 'haiku', effort: 'medium', system: [{ text: RULES, cache: true }], prompt: `The draft:\n\n${draft}`, maxTokens: 3500, timeoutMs: 30000 })
    if (!r.isAnswered || !r.text.trim()) {
      return next({ ...e, text: draft, context: [...(e.context ?? []), 'Master prompt could not rewrite this message; it is the user\'s own words.'] })
    }
    return next({
      ...e,
      text: r.text.trim(),
      context: [...(e.context ?? []), `Master prompt: The user's message above was rewritten from their draft. Start your reply with the rewritten request in a short quote so they can check it, then do it. If the rewrite lost or changed anything from their own words, follow their words. Their own words:\n\n${draft}`],
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isArmed = await read($, armed)
    await read($, tick)
    const m = await read($, meter)
    const last = await read($, lastReplyAt)
    const now = await $.clock.now()
    const left = last === null ? null : Math.ceil((last + CACHE_MS - now) / 60000)
    const cache = left === null ? '' : left > 0 ? ` · cache warm ${left}m` : ' · cache cold'
    const usage = m ? `5h ${pct(m.fiveHour)} · week ${pct(m.week)} · chat ${pct(m.ctx)}` : ''
    return (
      <Box>
        <Button key="master" label={isArmed ? '✨ Master prompt: ON for your next message' : '✨ Master prompt'} onPress={() => tap($)} />
        <Text dimColor> {usage}{cache}</Text>
      </Box>
    )
  })
}
