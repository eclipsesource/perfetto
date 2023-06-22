// Copyright (C) 2020 The Android Open Source Project
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

import m from 'mithril';

import {Actions} from '../common/actions';
import {globals, HasGlobalsContextAttrs} from './globals';
import {createPage} from './pages';
import {Button} from './widgets/button';

function getCurrSelectedMetric(globalsContext: string) {
  const {availableMetrics, selectedIndex} = globals(globalsContext).state.metrics;
  if (!availableMetrics) return undefined;
  if (selectedIndex === undefined) return undefined;
  return availableMetrics[selectedIndex];
}

class MetricResult implements m.ClassComponent<HasGlobalsContextAttrs> {
  view({attrs}: m.Vnode<HasGlobalsContextAttrs>) {
    const globalsContext = attrs.globalsContext;
    const metricResult = globals(globalsContext).metricResult;
    if (metricResult === undefined) return undefined;
    const currSelection = getCurrSelectedMetric(globalsContext);
    if (!(metricResult && metricResult.name === currSelection)) {
      return undefined;
    }
    if (metricResult.error !== undefined) {
      return m('pre.metric-error', metricResult.error);
    }
    if (metricResult.resultString !== undefined) {
      return m('pre', metricResult.resultString);
    }
    return undefined;
  }
}

class MetricPicker implements m.ClassComponent<HasGlobalsContextAttrs> {
  view({attrs}: m.Vnode<HasGlobalsContextAttrs>) {
    const globalsContext = attrs.globalsContext;
    const {availableMetrics, selectedIndex} = globals(globalsContext).state.metrics;
    if (availableMetrics === undefined) return 'Loading metrics...';
    if (availableMetrics.length === 0) return 'No metrics available';
    if (selectedIndex === undefined) {
      throw Error('Should not happen when avaibleMetrics is non-empty');
    }

    return m('div', [
      'Select a metric:',
      m('select',
        {
          selectedIndex: globals(globalsContext).state.metrics.selectedIndex,
          onchange: (e: InputEvent) => {
            globals(globalsContext).dispatch(Actions.setMetricSelectedIndex(
                {index: (e.target as HTMLSelectElement).selectedIndex}));
          },
        },
        availableMetrics.map(
            (metric) => m('option', {value: metric, key: metric}, metric))),
      m(Button, {
        onclick: () => globals(globalsContext).dispatch(Actions.requestSelectedMetric({})),
        label: 'Run',
      }),
    ]);
  }
}

export const MetricsPage = createPage({
  view({attrs}) {
    return m(
        '.metrics-page',
        m(MetricPicker, attrs),
        m(MetricResult, attrs),
    );
  },
});
