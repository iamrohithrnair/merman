export type MermanMarkdownArgs<Surface> = {
  surface: Surface
  text: string
  columns: number
}

export type Merman<Surface, Drawing> = {
  markdown: (args: MermanMarkdownArgs<Surface>) => Promise<Drawing | undefined>
}

declare module 'claude-code' {
  interface EngineInterface {
    merman: Merman<RenderSurface, RenderElement>
  }
  interface PluginState {
    merman: {
      formulas: Record<string, unknown>
      dir: string
      unfolded: string[]
      sent: { text: string; at: number }[]
      turnEnds: { durationMs: number; at: number }[]
      setupAt: number
      setupFocus: string
      setupLand: string
      foundPaths: string[]
      drawn: StateFamily<number>
    }
  }
}
