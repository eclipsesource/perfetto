// Copyright (C) 2021 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {BigintMath as BIMath} from '../../base/bigint_math';
import {PluginContext} from '../../common/plugin_api';
import {LONG, LONG_NULL, NUM, STR} from '../../common/query_result';
import {TPDuration, TPTime} from '../../common/time';
import {TrackData} from '../../common/track_data';
import {
  TrackController,
} from '../../controller/track_controller';
import {NewTrackArgs, Track} from '../../frontend/track';
import {ChromeSliceTrack, Instant} from '../chrome_slices';
import {contrastingTextColor} from '../../frontend/hsluv_cache';

export const ASYNC_SLICE_TRACK_KIND = 'AsyncSliceTrack';

const SLICE_HEIGHT = 18;
const DIAMOND_WIDTH_PX = 16;
const HALF_SLICE_HEIGHT = SLICE_HEIGHT / 2;
const HALF_DIAMOND_WIDTH_PX = DIAMOND_WIDTH_PX / 2;

export interface Config {
  maxDepth: number;
  trackIds: number[];
}

export interface Data extends TrackData {
  // Slices are stored in a columnar fashion. All fields have the same length.
  strings: string[];
  sliceIds: Float64Array;
  starts: BigInt64Array;
  ends: BigInt64Array;
  depths: Uint16Array;
  titles: Uint16Array;  // Index in |strings|.
  isInstant: Uint16Array;
  isIncomplete: Uint16Array;
}

class AsyncSliceTrackController extends TrackController<Config, Data> {
  static readonly kind = ASYNC_SLICE_TRACK_KIND;
  private maxDurNs: TPDuration = 0n;

  async onBoundsChange(start: TPTime, end: TPTime, resolution: TPDuration):
      Promise<Data> {
    if (this.maxDurNs === 0n) {
      const maxDurResult = await this.query(`
        select max(iif(dur = -1, (SELECT end_ts FROM trace_bounds) - ts, dur))
        as maxDur from experimental_slice_layout
        where filter_track_ids = '${this.config.trackIds.join(',')}'
      `);
      this.maxDurNs = maxDurResult.firstRow({maxDur: LONG_NULL}).maxDur || 0n;
    }

    const queryRes = await this.query(`
      SELECT
      (ts + ${resolution / 2n}) / ${resolution} * ${resolution} as tsq,
        ts,
        max(iif(dur = -1, (SELECT end_ts FROM trace_bounds) - ts, dur)) as dur,
        layout_depth as depth,
        ifnull(name, '[null]') as name,
        id,
        dur = 0 as isInstant,
        dur = -1 as isIncomplete
      from experimental_slice_layout
      where
        filter_track_ids = '${this.config.trackIds.join(',')}' and
        ts >= ${start - this.maxDurNs} and
        ts <= ${end}
      group by tsq, layout_depth
      order by tsq, layout_depth
    `);

    const numRows = queryRes.numRows();
    const slices: Data = {
      start,
      end,
      resolution,
      length: numRows,
      strings: [],
      sliceIds: new Float64Array(numRows),
      starts: new BigInt64Array(numRows),
      ends: new BigInt64Array(numRows),
      depths: new Uint16Array(numRows),
      titles: new Uint16Array(numRows),
      isInstant: new Uint16Array(numRows),
      isIncomplete: new Uint16Array(numRows),
    };

    const stringIndexes = new Map<string, number>();
    function internString(str: string) {
      let idx = stringIndexes.get(str);
      if (idx !== undefined) return idx;
      idx = slices.strings.length;
      slices.strings.push(str);
      stringIndexes.set(str, idx);
      return idx;
    }

    const it = queryRes.iter({
      tsq: LONG,
      ts: LONG,
      dur: LONG,
      depth: NUM,
      name: STR,
      id: NUM,
      isInstant: NUM,
      isIncomplete: NUM,
    });
    for (let row = 0; it.valid(); it.next(), row++) {
      const startQ = it.tsq;
      const start = it.ts;
      const dur = it.dur;
      const end = start + dur;
      const minEnd = startQ + resolution;
      const endQ = BIMath.max(BIMath.quant(end, resolution), minEnd);

      slices.starts[row] = startQ;
      slices.ends[row] = endQ;
      slices.depths[row] = it.depth;
      slices.titles[row] = internString(it.name);
      slices.sliceIds[row] = it.id;
      slices.isInstant[row] = it.isInstant;
      slices.isIncomplete[row] = it.isIncomplete;
    }
    return slices;
  }
}

export class AsyncSliceTrack extends ChromeSliceTrack {
  static readonly kind = ASYNC_SLICE_TRACK_KIND;
  static create(args: NewTrackArgs): Track {
    return new AsyncSliceTrack(args);
  }

  drawChevron(ctx: CanvasRenderingContext2D, instant?: Instant) {
    if (this.trackState.name.search(/^Buffer:? \d+/) !== 0) {
      // Not a GPU buffer, so draw a regular chevron
      return super.drawChevron(ctx);
    }
    if (!instant?.title) {
      // Don't need a diamond if there's no text to fill
      return super.drawChevron(ctx);
    }

    // Draw a diamond at a fixed location and size with the initial
    // of the instant's title at the centre. Should be used with
    // ctx.translate and ctx.scale to alter location and size.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(HALF_DIAMOND_WIDTH_PX, HALF_SLICE_HEIGHT);
    ctx.lineTo(0, SLICE_HEIGHT);
    ctx.lineTo(-HALF_DIAMOND_WIDTH_PX, HALF_SLICE_HEIGHT);
    ctx.lineTo(0, 0);
    ctx.fill();

    const x = 0;
    const y = (SLICE_HEIGHT + instant.tmAscent) / 2;
    ctx.fillStyle = contrastingTextColor(instant.color);
    ctx.fillText(instant.title.substring(0, 1).toUpperCase(), x, y);
  }
}

function activate(ctx: PluginContext) {
  ctx.registerTrackController(AsyncSliceTrackController);
  ctx.registerTrack(AsyncSliceTrack);
}

export const plugin = {
  pluginId: 'perfetto.AsyncSlices',
  activate,
};
