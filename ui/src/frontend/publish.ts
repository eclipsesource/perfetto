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

import {Actions} from '../common/actions';
import {AggregateData, isEmptyData} from '../common/aggregation_data';
import {ConversionJobStatusUpdate} from '../common/conversion_jobs';
import {
  LogBoundsKey,
  LogEntriesKey,
  LogExists,
  LogExistsKey,
} from '../common/logs';
import {MetricResult} from '../common/metric_data';
import {CurrentSearchResults, SearchSummary} from '../common/search_data';

import {
  CounterDetails,
  CpuProfileDetails,
  FlamegraphDetails,
  Flow,
  FtracePanelData,
  FtraceStat,
  globals,
  QuantizedLoad,
  SliceDetails,
  ThreadDesc,
  ThreadStateDetails,
} from './globals';
import {findCurrentSelection} from './keyboard_event_handler';

export function publishOverviewData(
    globalsContext: string,
    data: {[key: string]: QuantizedLoad|QuantizedLoad[]}) {
  for (const [key, value] of Object.entries(data)) {
    if (!globals(globalsContext).overviewStore.has(key)) {
      globals(globalsContext).overviewStore.set(key, []);
    }
    if (value instanceof Array) {
      globals(globalsContext).overviewStore.get(key)!.push(...value);
    } else {
      globals(globalsContext).overviewStore.get(key)!.push(value);
    }
  }
  globals(globalsContext).rafScheduler.scheduleRedraw();
}

export function clearOverviewData(globalsContext: string) {
  globals(globalsContext).overviewStore.clear();
  globals(globalsContext).rafScheduler.scheduleRedraw();
}

export function publishTrackData(globalsContext: string, args: {id: string, data: {}}) {
  globals(globalsContext).setTrackData(args.id, args.data);
  if ([LogExistsKey, LogBoundsKey, LogEntriesKey].includes(args.id)) {
    const data = globals(globalsContext).trackDataStore.get(LogExistsKey) as LogExists;
    if (data && data.exists) globals(globalsContext).rafScheduler.scheduleFullRedraw();
  } else {
    globals(globalsContext).rafScheduler.scheduleRedraw();
  }
}

export function publishMetricResult(globalsContext: string, metricResult: MetricResult) {
  globals(globalsContext).setMetricResult(metricResult);
  globals(globalsContext).publishRedraw();
}

export function publishSelectedFlows(globalsContext: string, selectedFlows: Flow[]) {
  globals(globalsContext).selectedFlows = selectedFlows;
  globals(globalsContext).publishRedraw();
}

export function publishCounterDetails(globalsContext: string, click: CounterDetails) {
  globals(globalsContext).counterDetails = click;
  globals(globalsContext).publishRedraw();
}

export function publishFlamegraphDetails(globalsContext: string, click: FlamegraphDetails) {
  globals(globalsContext).flamegraphDetails = click;
  globals(globalsContext).publishRedraw();
}

export function publishCpuProfileDetails(globalsContext: string, details: CpuProfileDetails) {
  globals(globalsContext).cpuProfileDetails = details;
  globals(globalsContext).publishRedraw();
}

export function publishFtraceCounters(globalsContext: string, counters: FtraceStat[]) {
  globals(globalsContext).ftraceCounters = counters;
  globals(globalsContext).publishRedraw();
}

export function publishConversionJobStatusUpdate(
    globalsContext: string, job: ConversionJobStatusUpdate) {
  globals(globalsContext).setConversionJobStatus(job.jobName, job.jobStatus);
  globals(globalsContext).publishRedraw();
}

export function publishLoading(globalsContext: string, numQueuedQueries: number) {
  globals(globalsContext).numQueuedQueries = numQueuedQueries;
  // TODO(hjd): Clean up loadingAnimation given that this now causes a full
  // redraw anyways. Also this should probably just go via the global state.
  globals(globalsContext).rafScheduler.scheduleFullRedraw();
}

export function publishBufferUsage(globalsContext: string, args: {percentage: number}) {
  globals(globalsContext).setBufferUsage(args.percentage);
  globals(globalsContext).publishRedraw();
}

export function publishSearch(globalsContext: string, args: SearchSummary) {
  globals(globalsContext).searchSummary = args;
  globals(globalsContext).publishRedraw();
}

export function publishSearchResult(globalsContext: string, args: CurrentSearchResults) {
  globals(globalsContext).currentSearchResults = args;
  globals(globalsContext).publishRedraw();
}

export function publishRecordingLog(globalsContext: string, args: {logs: string}) {
  globals(globalsContext).setRecordingLog(args.logs);
  globals(globalsContext).publishRedraw();
}

export function publishTraceErrors(globalsContext: string, numErrors: number) {
  globals(globalsContext).setTraceErrors(numErrors);
  globals(globalsContext).publishRedraw();
}

export function publishMetricError(globalsContext: string, error: string) {
  globals(globalsContext).setMetricError(error);
  globals(globalsContext).logging.logError(error, false);
  globals(globalsContext).publishRedraw();
}

export function publishAggregateData(
    globalsContext: string, args: {data: AggregateData, kind: string}) {
  globals(globalsContext).setAggregateData(args.kind, args.data);
  if (!isEmptyData(args.data)) {
    globals(globalsContext).dispatch(Actions.setCurrentTab({tab: args.data.tabName}));
  }
  globals(globalsContext).publishRedraw();
}

export function publishQueryResult(globalsContext: string, args: {id: string, data?: {}}) {
  globals(globalsContext).queryResults.set(args.id, args.data);
  globals(globalsContext).dispatch(Actions.setCurrentTab({tab: `query_result_${args.id}`}));
  globals(globalsContext).publishRedraw();
}

export function publishThreads(globalsContext: string, data: ThreadDesc[]) {
  globals(globalsContext).threads.clear();
  data.forEach((thread) => {
    globals(globalsContext).threads.set(thread.utid, thread);
  });
  globals(globalsContext).publishRedraw();
}

export function publishSliceDetails(globalsContext: string, click: SliceDetails) {
  globals(globalsContext).sliceDetails = click;
  const id = click.id;
  if (id !== undefined && id === globals(globalsContext).state.pendingScrollId) {
    findCurrentSelection(globalsContext);
    globals(globalsContext).dispatch(Actions.setCurrentTab({tab: 'slice'}));
    globals(globalsContext).dispatch(Actions.clearPendingScrollId({id: undefined}));
  }
  globals(globalsContext).publishRedraw();
}

export function publishThreadStateDetails(globalsContext: string, click: ThreadStateDetails) {
  globals(globalsContext).threadStateDetails = click;
  globals(globalsContext).publishRedraw();
}

export function publishConnectedFlows(globalsContext: string, connectedFlows: Flow[]) {
  globals(globalsContext).connectedFlows = connectedFlows;
  // If a chrome slice is selected and we have any flows in connectedFlows
  // we will find the flows on the right and left of that slice to set a default
  // focus. In all other cases the focusedFlowId(Left|Right) will be set to -1.
  globals(globalsContext).dispatch(Actions.setHighlightedFlowLeftId({flowId: -1}));
  globals(globalsContext).dispatch(Actions.setHighlightedFlowRightId({flowId: -1}));
  if (globals(globalsContext).state.currentSelection?.kind === 'CHROME_SLICE') {
    const sliceId = (globals(globalsContext).state.currentSelection! as any).id;
    for (const flow of globals(globalsContext).connectedFlows) {
      if (flow.begin.sliceId === sliceId) {
        globals(globalsContext).dispatch(Actions.setHighlightedFlowRightId({flowId: flow.id}));
      }
      if (flow.end.sliceId === sliceId) {
        globals(globalsContext).dispatch(Actions.setHighlightedFlowLeftId({flowId: flow.id}));
      }
    }
  }

  globals(globalsContext).publishRedraw();
}

export function publishFtracePanelData(globalsContext: string, data: FtracePanelData) {
  globals(globalsContext).ftracePanelData = data;
  globals(globalsContext).publishRedraw();
}
