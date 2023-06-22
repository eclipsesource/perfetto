// Copyright (C) 2019 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use size file except in compliance with the License.
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

import {assertExists, assertTrue} from '../base/logging';
import {Actions} from '../common/actions';
import {
  ALLOC_SPACE_MEMORY_ALLOCATED_KEY,
  OBJECTS_ALLOCATED_KEY,
  OBJECTS_ALLOCATED_NOT_FREED_KEY,
  PERF_SAMPLES_KEY,
  SPACE_MEMORY_ALLOCATED_NOT_FREED_KEY,
} from '../common/flamegraph_util';
import {
  CallsiteInfo,
  FlamegraphStateViewingOption,
  ProfileType,
} from '../common/state';
import {tpTimeToCode} from '../common/time';
import {profileType} from '../controller/flamegraph_controller';

import {Flamegraph, NodeRendering} from './flamegraph';
import {GlobalsFunction} from './globals';
import {Modal} from './modal';
import {Panel, PanelAttrs, PanelSize} from './panel';
import {debounce} from './rate_limiters';
import {Router} from './router';
import {getCurrentTrace} from './sidebar';
import {convertTraceToPprofAndDownload} from './trace_converter';
import {Button} from './widgets/button';
import {findRef} from './widgets/utils';

interface FlamegraphDetailsPanelAttrs extends PanelAttrs {}

const HEADER_HEIGHT = 30;

function toSelectedCallsite(c: CallsiteInfo|undefined): string {
  if (c !== undefined && c.name !== undefined) {
    return c.name;
  }
  return '(none)';
}

const RENDER_SELF_AND_TOTAL: NodeRendering = {
  selfSize: 'Self',
  totalSize: 'Total',
};
const RENDER_OBJ_COUNT: NodeRendering = {
  selfSize: 'Self objects',
  totalSize: 'Subtree objects',
};

export class FlamegraphDetailsPanel extends Panel<FlamegraphDetailsPanelAttrs> {
  private profileType?: ProfileType = undefined;
  private ts = 0n;
  private pids: number[] = [];
  private flamegraph: Flamegraph = new Flamegraph([]);
  private focusRegex = '';
  private updateFocusRegexDebounced = debounce(() => {
    this.updateFocusRegex();
  }, 20);
  private canvas?: HTMLCanvasElement;

  view() {
    const flamegraphDetails = this.globals().flamegraphDetails;
    if (flamegraphDetails && flamegraphDetails.type !== undefined &&
        flamegraphDetails.start !== undefined &&
        flamegraphDetails.dur !== undefined &&
        flamegraphDetails.pids !== undefined &&
        flamegraphDetails.upids !== undefined) {
      this.profileType = profileType(flamegraphDetails.type);
      this.ts = flamegraphDetails.start + flamegraphDetails.dur;
      this.pids = flamegraphDetails.pids;
      if (flamegraphDetails.flamegraph) {
        this.flamegraph.updateDataIfChanged(
            this.nodeRendering(), flamegraphDetails.flamegraph);
      }
      const height = flamegraphDetails.flamegraph ?
          this.flamegraph.getHeight() + HEADER_HEIGHT :
          0;
      return m(
          '.details-panel',
          this.maybeShowModal(flamegraphDetails.graphIncomplete),
          m('.details-panel-heading.flamegraph-profile',
            {onclick: (e: MouseEvent) => e.stopPropagation()},
            [
              m('div.options',
                [
                  m('div.title', this.getTitle()),
                  this.getViewingOptionButtons(),
                ]),
              m('div.details',
                [
                  m('div.selected',
                    `Selected function: ${
                        toSelectedCallsite(
                            flamegraphDetails.expandedCallsite)}`),
                  m('div.time',
                    `Snapshot time: ${tpTimeToCode(flamegraphDetails.dur)}`),
                  m('input[type=text][placeholder=Focus]', {
                    oninput: (e: Event) => {
                      const target = (e.target as HTMLInputElement);
                      this.focusRegex = target.value;
                      this.updateFocusRegexDebounced();
                    },
                    // Required to stop hot-key handling:
                    onkeydown: (e: Event) => e.stopPropagation(),
                  }),
                  (this.profileType === ProfileType.NATIVE_HEAP_PROFILE ||
                   this.profileType === ProfileType.JAVA_HEAP_SAMPLES) &&
                      m(Button, {
                        icon: 'file_download',
                        onclick: () => {
                          this.downloadPprof();
                        },
                      }),
                ]),
            ]),
          m(`canvas[ref=canvas]`, {
            style: `height:${height}px; width:100%`,
            onmousemove: (e: MouseEvent) => {
              const {offsetX, offsetY} = e;
              this.onMouseMove({x: offsetX, y: offsetY});
            },
            onmouseout: () => {
              this.onMouseOut();
            },
            onclick: (e: MouseEvent) => {
              const {offsetX, offsetY} = e;
              this.onMouseClick({x: offsetX, y: offsetY});
            },
          }),
      );
    } else {
      return m(
          '.details-panel',
          m('.details-panel-heading', m('h2', `Flamegraph Profile`)));
    }
  }


  private maybeShowModal(graphIncomplete?: boolean) {
    if (!graphIncomplete || this.globals().state.flamegraphModalDismissed) {
      return undefined;
    }
    return m(Modal, {
      globalsContext: this.globals.context,
      title: 'The flamegraph is incomplete',
      vAlign: 'TOP',
      content: m('div',
          'The current trace does not have a fully formed flamegraph'),
      buttons: [
        {
          text: 'Show the errors',
          primary: true,
          action: () => Router.navigate(this.globals.context, '#!/info'),
        },
        {
          text: 'Skip',
          action: () => {
            this.globals().dispatch(Actions.dismissFlamegraphModal({}));
            this.globals().rafScheduler.scheduleFullRedraw();
          },
        },
      ],
    });
  }

  private getTitle(): string {
    switch (this.profileType!) {
      case ProfileType.HEAP_PROFILE:
        return 'Heap profile:';
      case ProfileType.NATIVE_HEAP_PROFILE:
        return 'Native heap profile:';
      case ProfileType.JAVA_HEAP_SAMPLES:
        return 'Java heap samples:';
      case ProfileType.JAVA_HEAP_GRAPH:
        return 'Java heap graph:';
      case ProfileType.PERF_SAMPLE:
        return 'Profile:';
      default:
        throw new Error('unknown type');
    }
  }

  private nodeRendering(): NodeRendering {
    if (this.profileType === undefined) {
      return {};
    }
    const viewingOption = this.globals().state.currentFlamegraphState!.viewingOption;
    switch (this.profileType) {
      case ProfileType.JAVA_HEAP_GRAPH:
        if (viewingOption === OBJECTS_ALLOCATED_NOT_FREED_KEY) {
          return RENDER_OBJ_COUNT;
        } else {
          return RENDER_SELF_AND_TOTAL;
        }
      case ProfileType.HEAP_PROFILE:
      case ProfileType.NATIVE_HEAP_PROFILE:
      case ProfileType.JAVA_HEAP_SAMPLES:
      case ProfileType.PERF_SAMPLE:
        return RENDER_SELF_AND_TOTAL;
      default:
        throw new Error('unknown type');
    }
  }

  private updateFocusRegex() {
    this.globals().dispatch(Actions.changeFocusFlamegraphState({
      focusRegex: this.focusRegex,
    }));
  }

  getViewingOptionButtons(): m.Children {
    return m(
        'div',
        ...FlamegraphDetailsPanel.selectViewingOptions(
            assertExists(this.profileType), this.globals));
  }

  downloadPprof() {
    const engine = this.globals().getCurrentEngine();
    if (!engine) return;
    getCurrentTrace(this.globals.context)
        .then((file) => {
          assertTrue(
              this.pids.length === 1,
              'Native profiles can only contain one pid.');
          convertTraceToPprofAndDownload(file, this.pids[0], this.ts);
        })
        .catch((error) => {
          throw new Error(`Failed to get current trace ${error}`);
        });
  }

  private changeFlamegraphData() {
    const data = this.globals().flamegraphDetails;
    const flamegraphData = data.flamegraph === undefined ? [] : data.flamegraph;
    this.flamegraph.updateDataIfChanged(
        this.nodeRendering(), flamegraphData, data.expandedCallsite);
  }

  oncreate({dom}: m.CVnodeDOM<FlamegraphDetailsPanelAttrs>) {
    this.canvas = FlamegraphDetailsPanel.findCanvasElement(dom);
    // TODO(stevegolton): If we truely want to be standalone, then we shouldn't
    // rely on someone else calling the rafScheduler when the window is resized,
    // but it's good enough for now as we know the ViewerPage will do it.
    this.globals().rafScheduler.addRedrawCallback(this.rafRedrawCallback);
  }

  onupdate({dom}: m.CVnodeDOM<FlamegraphDetailsPanelAttrs>) {
    this.canvas = FlamegraphDetailsPanel.findCanvasElement(dom);
  }

  onremove(_vnode: m.CVnodeDOM<FlamegraphDetailsPanelAttrs>) {
    this.globals().rafScheduler.removeRedrawCallback(this.rafRedrawCallback);
  }

  private static findCanvasElement(dom: Element): HTMLCanvasElement|undefined {
    const canvas = findRef(dom, 'canvas');
    if (canvas && canvas instanceof HTMLCanvasElement) {
      return canvas;
    } else {
      return undefined;
    }
  }

  private rafRedrawCallback = () => {
    if (this.canvas) {
      const canvas = this.canvas;
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(devicePixelRatio, devicePixelRatio);
        const {offsetWidth: width, offsetHeight: height} = canvas;
        this.renderLocalCanvas(ctx, {width, height});
        ctx.restore();
      }
    }
  };

  renderCanvas() {
    // No-op
  }

  private renderLocalCanvas(ctx: CanvasRenderingContext2D, size: PanelSize) {
    this.changeFlamegraphData();
    const current = this.globals().state.currentFlamegraphState;
    if (current === null) return;
    const unit =
        current.viewingOption === SPACE_MEMORY_ALLOCATED_NOT_FREED_KEY ||
            current.viewingOption === ALLOC_SPACE_MEMORY_ALLOCATED_KEY ?
        'B' :
        '';
    this.flamegraph.draw(ctx, size.width, size.height, 0, 0, unit);
  }

  private onMouseClick({x, y}: {x: number, y: number}): boolean {
    const expandedCallsite = this.flamegraph.onMouseClick({x, y});
    this.globals().dispatch(Actions.expandFlamegraphState({expandedCallsite}));
    return true;
  }

  private onMouseMove({x, y}: {x: number, y: number}): boolean {
    this.flamegraph.onMouseMove({x, y});
    this.globals().rafScheduler.scheduleFullRedraw();
    return true;
  }

  private onMouseOut() {
    this.flamegraph.onMouseOut();
    this.globals().rafScheduler.scheduleFullRedraw();
  }

  private static selectViewingOptions(profileType: ProfileType, globals: GlobalsFunction) {
    switch (profileType) {
      case ProfileType.PERF_SAMPLE:
        return [this.buildButtonComponent(PERF_SAMPLES_KEY, 'Samples', globals)];
      case ProfileType.JAVA_HEAP_GRAPH:
        return [
          this.buildButtonComponent(
              SPACE_MEMORY_ALLOCATED_NOT_FREED_KEY, 'Size', globals),
          this.buildButtonComponent(OBJECTS_ALLOCATED_NOT_FREED_KEY, 'Objects', globals),
        ];
      case ProfileType.HEAP_PROFILE:
        return [
          this.buildButtonComponent(
              SPACE_MEMORY_ALLOCATED_NOT_FREED_KEY, 'Unreleased size', globals),
          this.buildButtonComponent(
              OBJECTS_ALLOCATED_NOT_FREED_KEY, 'Unreleased count', globals),
          this.buildButtonComponent(
              ALLOC_SPACE_MEMORY_ALLOCATED_KEY, 'Total size', globals),
          this.buildButtonComponent(OBJECTS_ALLOCATED_KEY, 'Total count', globals),
        ];
      case ProfileType.NATIVE_HEAP_PROFILE:
        return [
          this.buildButtonComponent(
              SPACE_MEMORY_ALLOCATED_NOT_FREED_KEY, 'Unreleased malloc size', globals),
          this.buildButtonComponent(
              OBJECTS_ALLOCATED_NOT_FREED_KEY, 'Unreleased malloc count', globals),
          this.buildButtonComponent(
              ALLOC_SPACE_MEMORY_ALLOCATED_KEY, 'Total malloc size', globals),
          this.buildButtonComponent(
              OBJECTS_ALLOCATED_KEY, 'Total malloc count', globals),
        ];
      case ProfileType.JAVA_HEAP_SAMPLES:
        return [
          this.buildButtonComponent(
              ALLOC_SPACE_MEMORY_ALLOCATED_KEY, 'Total allocation size', globals),
          this.buildButtonComponent(
              OBJECTS_ALLOCATED_KEY, 'Total allocation count', globals),
        ];
      default:
        throw new Error(`Unexpected profile type ${profileType}`);
    }
  }

  private static buildButtonComponent(
      viewingOption: FlamegraphStateViewingOption, text: string, globals: GlobalsFunction) {
    const active =
        (globals().state.currentFlamegraphState !== null &&
         globals().state.currentFlamegraphState!.viewingOption === viewingOption);
    return m(Button, {
      label: text,
      active,
      minimal: true,
      onclick: () => {
        globals().dispatch(Actions.changeViewFlamegraphState({viewingOption}));
      },
    });
  }
}
