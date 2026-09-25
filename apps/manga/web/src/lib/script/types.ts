// script.json, as `transcribe` writes it (transcribe/transcribe/emit.py).

export type LineType = 'dialogue' | 'thought' | 'narration' | 'caption' | 'sfx' | 'sign'

export interface ScriptLine {
  order: number
  panel: number | null
  /** Page pixels, x1 y1 x2 y2; null for a line the VLM found that Magi had no box for. */
  bbox: [number, number, number, number] | null
  speaker: string
  type: LineType
  text: string
  confidence: number | null
  source: 'magi' | 'magi+vlm' | 'vlm'
}

export interface ScriptPage {
  /** 0-based, the same as the reader's page. */
  index: number
  width: number
  height: number
  lines: ScriptLine[]
}

export interface Script {
  version: number
  series: string
  chapter: string
  title: string
  scanlator: string
  cast: string[]
  pages: ScriptPage[]
}

export interface SearchHit {
  series: string
  chapter: string
  title: string
  seriesId: number
  chapterId: number
  page: number
  line: number
  speaker: string
  text: string
  /** FTS5 snippet: matches between \u0002 and \u0003. */
  snippet: string
}
