export type Busy = 'idle' | 'working'
export type Meter = { fiveHour: number | null; week: number | null; weekResets: string | null; ctx: number | null }

declare module 'claude-code' {
  interface PluginState {
    'master-prompt': { busy: Busy; undo: string | null; meter: Meter | null; lastReplyAt: number | null; tick: number; armed: boolean }
  }
}
