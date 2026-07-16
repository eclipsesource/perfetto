// Copyright (C) 2026 The Sokatoa Project Authors
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

import {PerfettoPlugin} from '../../public/plugin';
import {Trace} from '../../public/trace';
import {TrackNode} from '../../public/workspace';
import {SqlTableCounterTrack} from '../../components/tracks/query_counter_track';
import {LONG, STR} from '../../trace_processor/query_result';

// AMIGO gperf daemon emits one logcat line every profiling tick, tag=GPERF, e.g.:
//   FPS(t/c/r)= 900 0 0 STATE= 0 ... F= 400 576 576 576 222 676 200 L/H= ... RQ_MIFMIN= 0 ...
// Each token ending in '=' starts a key whose value is the following run of numbers.
//
// Domain order (NUM_OF_DOMAIN=7, from boardconfig s5e9955 default.h):
//   0 CL0  1 CL1L  2 CL1H  3 CL2  4 GPU  5 MIF  6 DSU
// FPS(t/c/r) = Target / Latest(current) / Average, each scaled x10.
// F= is per-domain current frequency in kHz already divided by 1000 => MHz.
const GPERF_TAG = 'GPERF';

// idx = position within the parsed number[] for that key.
// scale = multiply raw value to get display units (fps values are x10 in the log).
interface Metric {
  col: string; // sql column name (identifier-safe)
  title: string; // track label
  key: string; // gperf log key (must include trailing '=')
  idx: number; // index into that key's value array
  scale?: number;
  unit?: string;
  group?: string; // optional sub-group label under the top-level "Gperf" node
}

// Domain order matches NUM_OF_DOMAIN in boardconfig/s5e9955/default.h:
//   0 CL0  1 CL1L  2 CL1H  3 CL2  4 GPU  5 MIF  6 DSU
// (col = identifier-safe slug, title = human label)
const DOMAINS = [
  {slug: 'cpu_cl0', label: 'CPU CL0 (little)'},
  {slug: 'cpu_cl1l', label: 'CPU CL1L'},
  {slug: 'cpu_cl1h', label: 'CPU CL1H'},
  {slug: 'cpu_cl2', label: 'CPU CL2 (big)'},
  {slug: 'gpu', label: 'GPU'},
  {slug: 'mif', label: 'MIF'},
  {slug: 'dsu', label: 'DSU'},
];

const METRICS: Metric[] = [
  // FPS(t/c/r)= Target / Latest(current) / Average, x10.
  {col: 'fps_current', title: 'FPS (current)', key: 'FPS(t/c/r)=', idx: 1, scale: 0.1, unit: 'fps', group: 'FPS'},
  {col: 'fps_target', title: 'FPS (target)', key: 'FPS(t/c/r)=', idx: 0, scale: 0.1, unit: 'fps', group: 'FPS'},
  {col: 'fps_average', title: 'FPS (average)', key: 'FPS(t/c/r)=', idx: 2, scale: 0.1, unit: 'fps', group: 'FPS'},

  // Per-domain metrics, generated from DOMAINS. Each domain gets its own sub-group.
  // F=   current freq per domain (already /1000 in the log => MHz).
  // AR=  active_pct per domain (already /10 in the log => percent).
  // T=   temperature per domain (degrees C).
  // L/H= min/max freq pairs per domain (min at idx 2*d, max at 2*d+1), MHz.
  ...DOMAINS.flatMap((d, i) => [
    {col: `${d.slug}_freq`, title: 'Freq', key: 'F=', idx: i, unit: 'MHz', group: d.label},
    {col: `${d.slug}_active`, title: 'Active', key: 'AR=', idx: i, unit: '%', group: d.label},
    {col: `${d.slug}_temp`, title: 'Temp', key: 'T=', idx: i, unit: '°C', group: d.label},
    {col: `${d.slug}_freq_min`, title: 'Freq (min)', key: 'L/H=', idx: 2 * i, unit: 'MHz', group: d.label},
    {col: `${d.slug}_freq_max`, title: 'Freq (max)', key: 'L/H=', idx: 2 * i + 1, unit: 'MHz', group: d.label},
  ]),

  // NET(KB/s)= upload / download.
  {col: 'net_up', title: 'Net Upload', key: 'NET(KB/s)=', idx: 0, unit: 'KB/s', group: 'Network'},
  {col: 'net_down', title: 'Net Download', key: 'NET(KB/s)=', idx: 1, unit: 'KB/s', group: 'Network'},
];

// Parse "KEY= a b c KEY2= d e" -> Map<key, number[]>.
function parseGperf(msg: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const toks = msg.trim().split(/\s+/);
  let curKey: string | undefined;
  for (const t of toks) {
    if (t.endsWith('=')) {
      curKey = t;
      out.set(curKey, []);
    } else if (curKey !== undefined) {
      const n = Number(t);
      if (!Number.isNaN(n)) {
        out.get(curKey)!.push(n);
      }
    }
  }
  return out;
}

export default class implements PerfettoPlugin {
  static readonly id = 'com.samsung.Gperf';

  async onTraceLoad(ctx: Trace): Promise<void> {
    const {engine} = ctx;

    // 1. Pull every GPERF log row.
    const res = await engine.query(
      `select ts, msg from android_logs where tag = '${GPERF_TAG}' order by ts`,
    );
    const it = res.iter({ts: LONG, msg: STR});
    const rows: {ts: bigint; vals: Map<string, number[]>}[] = [];
    for (; it.valid(); it.next()) {
      rows.push({ts: it.ts, vals: parseGperf(it.msg)});
    }
    if (rows.length === 0) {
      return; // no gperf data in this trace
    }

    // 2. Materialize a wide table: one column per metric.
    const colDefs = METRICS.map((mtr) => `${mtr.col} DOUBLE`).join(', ');
    await engine.query(`drop table if exists gperf_metrics`);
    await engine.query(`create table gperf_metrics (ts BIGINT, ${colDefs})`);

    const tuples = rows.map((r) => {
      const cells = METRICS.map((mtr) => {
        const arr = r.vals.get(mtr.key);
        const raw = arr?.[mtr.idx];
        if (raw === undefined) {
          return 'NULL';
        }
        return String(mtr.scale === undefined ? raw : raw * mtr.scale);
      });
      return `(${r.ts}, ${cells.join(', ')})`;
    });
    // Chunk inserts to keep individual SQL statements small.
    const CHUNK = 500;
    for (let i = 0; i < tuples.length; i += CHUNK) {
      await engine.query(
        `insert into gperf_metrics values ${tuples.slice(i, i + CHUNK).join(', ')}`,
      );
    }

    // 3. One counter track per metric, nested under per-metric sub-groups within
    //    a top-level "Gperf" summary node.
    const group = new TrackNode({name: 'Gperf', isSummary: true});
    const subGroups = new Map<string, TrackNode>();
    for (const mtr of METRICS) {
      const uri = `/gperf/${mtr.col}`;
      const track = new SqlTableCounterTrack(
        ctx,
        uri,
        `select ts, ${mtr.col} as value from gperf_metrics where ${mtr.col} is not null`,
        mtr.unit !== undefined ? {unit: mtr.unit} : undefined,
      );
      ctx.tracks.registerTrack({uri, renderer: track});

      const leaf = new TrackNode({name: mtr.title, uri});
      if (mtr.group === undefined) {
        group.addChildInOrder(leaf);
        continue;
      }
      let sub = subGroups.get(mtr.group);
      if (sub === undefined) {
        sub = new TrackNode({name: mtr.group, isSummary: true});
        subGroups.set(mtr.group, sub);
        group.addChildInOrder(sub);
      }
      sub.addChildInOrder(leaf);
    }
    ctx.defaultWorkspace.addChildFirst(group);
  }
}
