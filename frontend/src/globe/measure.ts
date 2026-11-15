// The Measure tool: the shared line drawing interaction (lineDraw.ts) with a yellow line,
// the ruler cursor and its own words. All mouse and keyboard handling lives in lineDraw.ts.
import type * as Cesium from 'cesium'
import { LineDrawer } from './lineDraw'
import type { LineState } from './lineDraw'

export type Measurement = LineState

/** What is measured: the length of a line, or the area inside a shape. */
export type MeasureKind = 'distance' | 'area'

export const MEASURE_KINDS: Array<{ id: MeasureKind; title: string; note: string }> = [
  { id: 'distance', title: 'Distance', note: 'The length of a line through your points.' },
  { id: 'area', title: 'Area', note: 'The area inside a shape, and the distance around it.' },
]

export class MeasureTool extends LineDrawer {
  constructor(viewer: Cesium.Viewer, onChange: (measurement: Measurement) => void) {
    super(viewer, {
      color: '#ffd23f', // a warm yellow: readable on Mars tan and on dark ground
      cursor: 'measure',
      onChange,
      words: {
        first: 'Click to place the first point',
        next: 'Click to add · Double click to finish',
        afterFinish: 'Click to start a new measurement',
      },
    })
  }

  setKind(kind: MeasureKind) {
    this.setClosed(kind === 'area')
  }
}
