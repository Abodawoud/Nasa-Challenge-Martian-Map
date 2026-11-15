// The Measure tool: the shared line drawing interaction (lineDraw.ts) with a yellow line,
// the ruler cursor and its own words. All mouse and keyboard handling lives in lineDraw.ts.
import type * as Cesium from 'cesium'
import { LineDrawer } from './lineDraw'
import type { LineState } from './lineDraw'

export type Measurement = LineState

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
}
