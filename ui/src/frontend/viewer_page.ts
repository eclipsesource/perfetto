// Copyright (C) 2018 The Android Open Source Project
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

import {BigintMath} from '../base/bigint_math';
import {clamp} from '../base/math_utils';
import {Actions} from '../common/actions';
import {featureFlags} from '../common/feature_flags';

import {TOPBAR_HEIGHT, TRACK_SHELL_WIDTH} from './css_constants';
import {DetailsPanel} from './details_panel';
import {globals} from './globals';
import {NotesPanel} from './notes_panel';
import {OverviewTimelinePanel} from './overview_timeline_panel';
import {createPage} from './pages';
import {PanAndZoomHandler} from './pan_and_zoom_handler';
import {AnyAttrsVnode, PanelContainer} from './panel_container';
import {TickmarkPanel} from './tickmark_panel';
import {TimeAxisPanel} from './time_axis_panel';
import {TimeSelectionPanel} from './time_selection_panel';
import {DISMISSED_PANNING_HINT_KEY} from './topbar';
import {TrackGroupPanel} from './track_group_panel';
import {TrackPanel} from './track_panel';
import {TrackGroupState, TrackState} from '../common/state';

const SIDEBAR_WIDTH = 256;

const OVERVIEW_PANEL_FLAG = featureFlags.register({
  id: 'overviewVisible',
  name: 'Overview Panel',
  description: 'Show the panel providing an overview of the trace',
  defaultValue: true,
});

// Checks if the mousePos is within 3px of the start or end of the
// current selected time range.
function onTimeRangeBoundary(mousePos: number): 'START'|'END'|null {
  const selection = globals.state.currentSelection;
  if (selection !== null && selection.kind === 'AREA') {
    // If frontend selectedArea exists then we are in the process of editing the
    // time range and need to use that value instead.
    const area = globals.frontendLocalState.selectedArea ?
        globals.frontendLocalState.selectedArea :
        globals.state.areas[selection.areaId];
    const {visibleTimeScale} = globals.frontendLocalState;
    const start = visibleTimeScale.tpTimeToPx(area.start);
    const end = visibleTimeScale.tpTimeToPx(area.end);
    const startDrag = mousePos - TRACK_SHELL_WIDTH;
    const startDistance = Math.abs(start - startDrag);
    const endDistance = Math.abs(end - startDrag);
    const range = 3 * window.devicePixelRatio;
    // We might be within 3px of both boundaries but we should choose
    // the closest one.
    if (startDistance < range && startDistance <= endDistance) return 'START';
    if (endDistance < range && endDistance <= startDistance) return 'END';
  }
  return null;
}

export interface TrackGroupAttrs {
  header: AnyAttrsVnode;
  collapsed: boolean;
  childTracks: AnyAttrsVnode[];
}

export class TrackGroup implements m.ClassComponent<TrackGroupAttrs> {
  view() {
    // TrackGroup component acts as a holder for a bunch of tracks rendered
    // together: the actual rendering happens in PanelContainer. In order to
    // avoid confusion, this method remains empty.
  }
}

export interface TraceViewerAttrs {
  /** If true, scope the handling of pan/zoom/help etc. keys to the page content only. */
  scopedKeyHandling?: boolean;
}

/**
 * Top-most level component for the viewer page. Holds tracks, brush timeline,
 * panels, and everything else that's part of the main trace viewer page.
 */
class TraceViewer implements m.ClassComponent<TraceViewerAttrs> {
  private onResize: () => void = () => {};
  private zoomContent?: PanAndZoomHandler;
  // Used to prevent global deselection if a pan/drag select occurred.
  private keepCurrentSelection = false;

  oncreate(vnode: m.CVnodeDOM<TraceViewerAttrs>) {
    const frontendLocalState = globals.frontendLocalState;
    const updateDimensions = () => {
      const rect = vnode.dom.getBoundingClientRect();
      frontendLocalState.updateLocalLimits(
          0,
          rect.width - TRACK_SHELL_WIDTH -
              frontendLocalState.getScrollbarWidth());
    };

    updateDimensions();

    // TODO: Do resize handling better.
    this.onResize = () => {
      updateDimensions();
      globals.rafScheduler.scheduleFullRedraw();
    };

    // Once ResizeObservers are out, we can stop accessing the window here.
    window.addEventListener('resize', this.onResize);

    const panZoomEl =
        vnode.dom.querySelector('.pan-and-zoom-content') as HTMLElement;
    const page = vnode.attrs.scopedKeyHandling ? vnode.dom as HTMLElement : undefined;

    this.zoomContent = new PanAndZoomHandler({
      element: panZoomEl,
      page,
      contentOffsetX: SIDEBAR_WIDTH,
      onPanned: (pannedPx: number) => {
        const {
          visibleTimeScale,
        } = globals.frontendLocalState;

        this.keepCurrentSelection = true;
        const tDelta = visibleTimeScale.pxDeltaToDuration(pannedPx);
        frontendLocalState.panVisibleWindow(tDelta);

        // If the user has panned they no longer need the hint.
        localStorage.setItem(DISMISSED_PANNING_HINT_KEY, 'true');
        globals.rafScheduler.scheduleRedraw();
      },
      onZoomed: (zoomedPositionPx: number, zoomRatio: number) => {
        // TODO(hjd): Avoid hardcoding TRACK_SHELL_WIDTH.
        // TODO(hjd): Improve support for zooming in overview timeline.
        const zoomPx = zoomedPositionPx - TRACK_SHELL_WIDTH;
        const rect = vnode.dom.getBoundingClientRect();
        const centerPoint = zoomPx / (rect.width - TRACK_SHELL_WIDTH);
        frontendLocalState.zoomVisibleWindow(1 - zoomRatio, centerPoint);
        globals.rafScheduler.scheduleRedraw();
      },
      editSelection: (currentPx: number) => {
        return onTimeRangeBoundary(currentPx) !== null;
      },
      onSelection: (
          dragStartX: number,
          dragStartY: number,
          prevX: number,
          currentX: number,
          currentY: number,
          editing: boolean) => {
        const traceTime = globals.state.traceTime;
        const {visibleTimeScale} = frontendLocalState;
        this.keepCurrentSelection = true;
        if (editing) {
          const selection = globals.state.currentSelection;
          if (selection !== null && selection.kind === 'AREA') {
            const area = globals.frontendLocalState.selectedArea ?
                globals.frontendLocalState.selectedArea :
                globals.state.areas[selection.areaId];
            const newTime =
                visibleTimeScale.pxToHpTime(currentX - TRACK_SHELL_WIDTH)
                    .toTPTime();
            // Have to check again for when one boundary crosses over the other.
            const curBoundary = onTimeRangeBoundary(prevX);
            if (curBoundary == null) return;
            const keepTime = curBoundary === 'START' ? area.end : area.start;
            // When editing the time range we always use the saved tracks,
            // since these will not change.
            frontendLocalState.selectArea(
                BigintMath.max(
                    BigintMath.min(keepTime, newTime), traceTime.start),
                BigintMath.min(
                    BigintMath.max(keepTime, newTime), traceTime.end),
                globals.state.areas[selection.areaId].tracks);
          }
        } else {
          let startPx = Math.min(dragStartX, currentX) - TRACK_SHELL_WIDTH;
          let endPx = Math.max(dragStartX, currentX) - TRACK_SHELL_WIDTH;
          if (startPx < 0 && endPx < 0) return;
          const {pxSpan} = visibleTimeScale;
          startPx = clamp(startPx, pxSpan.start, pxSpan.end);
          endPx = clamp(endPx, pxSpan.start, pxSpan.end);
          frontendLocalState.selectArea(
              visibleTimeScale.pxToHpTime(startPx).toTPTime('floor'),
              visibleTimeScale.pxToHpTime(endPx).toTPTime('ceil'),
          );

          // we need to encount for the embedded scenario so we may not be at the very top
          // we remove the topbar height as it is added again in the rendering of the panel container
          const panelBounds = panZoomEl.getBoundingClientRect();
          frontendLocalState.areaY.start = dragStartY + panelBounds.y - TOPBAR_HEIGHT;
          frontendLocalState.areaY.end = currentY + panelBounds.y - TOPBAR_HEIGHT;
        }
        globals.rafScheduler.scheduleRedraw();
      },
      endSelection: (edit: boolean) => {
        globals.frontendLocalState.areaY.start = undefined;
        globals.frontendLocalState.areaY.end = undefined;
        const area = globals.frontendLocalState.selectedArea;
        // If we are editing we need to pass the current id through to ensure
        // the marked area with that id is also updated.
        if (edit) {
          const selection = globals.state.currentSelection;
          if (selection !== null && selection.kind === 'AREA' && area) {
            globals.dispatch(
                Actions.editArea({area, areaId: selection.areaId}));
          }
        } else if (area) {
          globals.makeSelection(Actions.selectArea({area}));
        }
        // Now the selection has ended we stored the final selected area in the
        // global state and can remove the in progress selection from the
        // frontendLocalState.
        globals.frontendLocalState.deselectArea();
        // Full redraw to color track shell.
        globals.rafScheduler.scheduleFullRedraw();
      },
    });
  }

  onremove() {
    window.removeEventListener('resize', this.onResize);
    if (this.zoomContent) this.zoomContent.shutdown();
  }

  view() {
    const rootNode: AnyAttrsVnode[] = [];
    const renderGroup = (group: TrackGroupState, panels: AnyAttrsVnode[]) => {
      const headerPanel = m(TrackGroupPanel, {
        trackGroupId: group.id,
        key: `trackgroup-${group.id}`,
        selectable: true,
      });

      const childTracks: AnyAttrsVnode[] = [];
      if (!group.collapsed) {
        for (const id of group.sortOrder) {
          if (group.tracks.includes(id) && id !== group.tracks[0]) {
            childTracks.push(m(TrackPanel, {
              key: `track-${group.id}-${id}`,
              id,
              selectable: true,
            }));
            continue;
          }
          const trackGroup = globals.state.trackGroups[id];
          if (trackGroup && trackGroup.name) {
            renderGroup(trackGroup, childTracks);
          }
        }
      }

      panels.push(m(TrackGroup, {
        header: headerPanel,
        collapsed: group.collapsed,
        childTracks,
      } as TrackGroupAttrs));
    };

    globals.state.scrollingTracks.forEach(
      (id) => {
        let trackLike : TrackState | TrackGroupState =
        globals.state.trackGroups[id];
        // Check groups first since summary tracks have same id a lot of times
        // If is a trackGroup
        if (trackLike) {
          renderGroup(trackLike, rootNode);
        }
        trackLike = globals.state.tracks[id];
        // If is a track
        if (trackLike) {
          rootNode.push(m(TrackPanel, {key: id, id, selectable: true}));
          return;
        }
      },
    );

    const overviewPanel = [];
    if (OVERVIEW_PANEL_FLAG.get()) {
      overviewPanel.push(m(OverviewTimelinePanel, {key: 'overview'}));
    }

    return m(
        '.page',
        m('.split-panel',
          m('.pan-and-zoom-content',
            {
              onclick: () => {
                // We don't want to deselect when panning/drag selecting.
                if (this.keepCurrentSelection) {
                  this.keepCurrentSelection = false;
                  return;
                }
                globals.makeSelection(Actions.deselect({}));
              },
            },
            m('.pinned-panel-container', m(PanelContainer, {
                doesScroll: false,
                panels: [
                  ...overviewPanel,
                  m(TimeAxisPanel, {key: 'timeaxis'}),
                  m(TimeSelectionPanel, {key: 'timeselection'}),
                  m(NotesPanel, {key: 'notes'}),
                  m(TickmarkPanel, {key: 'searchTickmarks'}),
                  ...globals.state.pinnedTracks.map(
                      (id) => m(TrackPanel, {
                        key: id,
                        id,
                        selectable: true,
                        pinnedCopy: true})),
                ],
                kind: 'OVERVIEW',
              })),
            m('.scrolling-panel-container', m(PanelContainer, {
                doesScroll: true,
                panels: rootNode,
                kind: 'TRACKS',
              })))),
        m(DetailsPanel));
  }
}

export const ViewerPage = createPage({
  view() {
    return m(TraceViewer);
  },
});

export function createViewerPage(attrs: TraceViewerAttrs) {
  return createPage({
    view() {
      return m(TraceViewer, attrs);
    },
  });
}
