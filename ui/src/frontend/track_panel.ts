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

import {hex} from 'color-convert';
import m from 'mithril';

import {Actions, DeferredAction} from '../common/actions';
import {TrackGroupState, TrackState} from '../common/state';
import {TPTime} from '../common/time';

import {TRACK_SHELL_WIDTH, getCssStr} from './css_constants';
import {PerfettoMouseEvent} from './events';
import {globals} from './globals';
import {drawGridLines} from './gridline_helper';
import {BLANK_CHECKBOX, CHECKBOX, PIN} from './icons';
import {Panel, PanelSize} from './panel';
import {verticalScrollToTrack} from './scroll_helper';
import {SliceRect, Track} from './track';
import {trackRegistry} from './track_registry';
import {
  drawVerticalLineAtTime,
} from './vertical_line_helper';
import {getActiveVsyncData, renderVsyncColumns} from './vsync_helper';
import {SCROLLING_TRACK_GROUP, getContainingTrackIds} from '../common/state';

function getTitleSize(title: string): string|undefined {
  const length = title.length;
  if (length > 55) {
    return '9px';
  }
  if (length > 50) {
    return '10px';
  }
  if (length > 45) {
    return '11px';
  }
  if (length > 40) {
    return '12px';
  }
  if (length > 35) {
    return '13px';
  }
  return undefined;
}

function isPinned(id: string) {
  return globals.state.pinnedTracks.indexOf(id) !== -1;
}

function isSelected(id: string) {
  const selection = globals.state.currentSelection;
  if (selection === null || selection.kind !== 'AREA') return false;
  const selectedArea = globals.state.areas[selection.areaId];
  return selectedArea.tracks.includes(id);
}

const RESIZING_HEIGHT_PX = 5;
export function checkTrackForResizability(
  e: MouseEvent,
  track: Track,
  resize: (e: MouseEvent) => void): void {
    if (track.supportsResizing) {
      if (e.currentTarget instanceof HTMLElement &&
          e.type !== 'mouseleave' &&
          e.pageY - e.currentTarget.getBoundingClientRect().top >=
          e.currentTarget.clientHeight - RESIZING_HEIGHT_PX
          ) {
          const timelineElement: HTMLDivElement | null = e.currentTarget.closest('div.pan-and-zoom-content');
          timelineElement?.addEventListener('mousedown', resize);
          e.currentTarget.style.cursor = 'row-resize';
          return;
      } else if (e.currentTarget instanceof HTMLElement) {
        const timelineElement: HTMLDivElement | null = e.currentTarget.closest('div.pan-and-zoom-content');
        timelineElement?.removeEventListener('mousedown', resize);
        e.currentTarget.style.cursor = 'unset';
      }
    }
}
export function resizeTrack(
  e: MouseEvent,
  track: Track,
  trackState: TrackState,
  defaultHeight: number,
  pinnedCopy?: boolean ): void {
  if (e.currentTarget instanceof HTMLElement) {
    const timelineElement = e.currentTarget.closest('div.pan-and-zoom-content');
    if (timelineElement && timelineElement instanceof HTMLDivElement) {
      let trackHeight = track.getHeight();
      let mouseY = e.clientY;
      const mouseMoveEvent = (evMove: MouseEvent): void => {
        evMove.preventDefault();
        let movementY = evMove.clientY-mouseY;
        if (pinnedCopy !== true &&
          isPinned(trackState.id)) {
          movementY /=2;
        }
        trackHeight += movementY;
        mouseY = evMove.clientY;
        const newMultiplier = trackHeight / defaultHeight;
        trackState.scaleFactor = Math.max(1, newMultiplier);
        globals.rafScheduler.scheduleFullRedraw();
      };
      const mouseReturnEvent = () : void => {
        timelineElement.addEventListener('mousemove', mouseMoveEvent);
        timelineElement.removeEventListener('mouseenter', mouseReturnEvent);
      };
      const mouseLeaveEvent = () : void => {
        timelineElement.removeEventListener('mousemove', mouseMoveEvent);
        timelineElement.addEventListener('mouseenter', mouseReturnEvent);
      };
      const mouseUpEvent = (): void => {
        timelineElement.removeEventListener('mousemove', mouseMoveEvent);
        document.removeEventListener('mouseup', mouseUpEvent);
        timelineElement.removeEventListener('mouseenter', mouseReturnEvent);
        timelineElement.removeEventListener('mouseleave', mouseLeaveEvent);
      };
      timelineElement.addEventListener('mousemove', mouseMoveEvent);
      timelineElement.addEventListener('mouseleave', mouseLeaveEvent);
      document.addEventListener('mouseup', mouseUpEvent);
    }
  }
};

interface TrackShellAttrs {
  track: Track;
  trackState: TrackState;
  pinnedCopy?: boolean;
}

class TrackShell implements m.ClassComponent<TrackShellAttrs> {
  // Set to true when we click down and drag the
  private dragging = false;
  private dropping: 'before'|'after'|undefined = undefined;
  private attrs?: TrackShellAttrs;
  private defaultHeight?: number;

  oninit(vnode: m.Vnode<TrackShellAttrs>) {
    this.attrs = vnode.attrs;
    if (this.attrs) {
      this.defaultHeight =
        this.attrs.track.getHeight() / this.attrs.trackState.scaleFactor;
    }
  }

  view({attrs}: m.CVnode<TrackShellAttrs>) {
    // The shell should be highlighted if the current search result is inside
    // this track.
    let highlightClass = '';
    const searchIndex = globals.state.searchIndex;
    if (searchIndex !== -1) {
      const trackId = globals.currentSearchResults.trackIds[searchIndex];
      if (trackId === attrs.trackState.id) {
        highlightClass = 'flash';
      }
    }

    const depth = (attrs.trackState.trackGroup === SCROLLING_TRACK_GROUP ?
      0 :
      getContainingTrackIds(globals.state, attrs.trackState.id)?.length ?? 0) +
      1;
    const trackTitle = attrs.trackState.title ?? attrs.trackState.name;
    const titleStyling: Record<string, string|undefined> = {
      fontSize: getTitleSize(trackTitle),
    };
      titleStyling.marginLeft = `${depth/2}rem`;

    const dragClass = this.dragging ? `drag` : '';
    const dropClass = this.dropping ? `drop-${this.dropping}` : '';


    return m(
        `.track-shell[draggable=true]`,
        {
          class: `${highlightClass} ${dragClass} ${dropClass} ${globals.state.selectedTrackIds.has(attrs.trackState.id)? 'selected': ''}`,
          onclick: (e: MouseEvent)=>{
            if (!e.ctrlKey) {
              globals.dispatch(
                Actions.clearTrackAndGroupSelection({}));
            }
            if (e.shiftKey && globals.state.lastSelectedTrackId) {
              // Check if parent group of last selected is same as current
              // If yes, turn all tracks in range to on
              const lastSelectedTrack =
                globals.state.tracks[globals.state.lastSelectedTrackId];
                if (lastSelectedTrack &&
                    lastSelectedTrack.trackGroup &&
                    lastSelectedTrack.trackGroup ===
                    attrs.trackState.trackGroup) {
                  const parentGroup =
                    globals.state.trackGroups[lastSelectedTrack.trackGroup];
                  if (parentGroup) {
                    const firstTrackIndex = parentGroup.sortOrder.findIndex(
                      (value)=>value=== lastSelectedTrack.id);
                    const secondTrackIndex = parentGroup.sortOrder.findIndex(
                          (value)=>value=== attrs.trackState.id);
                    let idsToSelect: string[] = [];
                    if (firstTrackIndex<secondTrackIndex) {
                      idsToSelect = parentGroup.sortOrder.slice(
                           firstTrackIndex,
                           secondTrackIndex+1,
                         );
                    } else {
                      idsToSelect = parentGroup.sortOrder.slice(
                        secondTrackIndex,
                        firstTrackIndex+1,
                      );
                    }
                    const actions: DeferredAction[] = [];
                    idsToSelect.forEach((trackId)=>{
                      if (!globals.state.selectedTrackIds.has(trackId)) {
                        actions.push(Actions.toggleTrackSelection({trackId}));
                      }
                    });
                    globals.dispatchMultiple(actions);
                    return;
                  }
                }
            }
            globals.dispatch(
              Actions.toggleTrackSelection({trackId: attrs.trackState.id}));
          },
          ondragstart: this.ondragstart.bind(this),
          ondragenter: (e: DragEvent)=>{
            e.preventDefault();
            e.stopPropagation();
          },
          ondragend: this.ondragend.bind(this),
          ondragover: this.ondragover.bind(this),
          ondragleave: this.ondragleave.bind(this),
          ondrop: this.ondrop.bind(this),
          onmousemove: this.onmousemove.bind(this),
          onmouseleave: this.onmouseleave.bind(this),
        },
        m(
            'h1',
            {
              title: attrs.trackState.description,
              style: titleStyling,
            },
            trackTitle,
            ('namespace' in attrs.trackState.config) &&
                m('span.chip', 'metric'),
            ),
        m('.track-buttons',
          ...this.getTrackShellButtons(attrs),
          attrs.track.getContextMenu(),
          m(TrackButton, {
            action: (e) => {
              // Scroll timeline by height of toggledPinnedTrack
              const toBePinned =
                !globals.state.pinnedTracks.includes(attrs.trackState.id);
              if (e.currentTarget && e.currentTarget instanceof Element) {
                const trackShell = e.currentTarget.closest('.track-shell');
                if (trackShell) {
                  let toScroll = trackShell.clientHeight;
                  if (!toBePinned) {
                    toScroll *= -1;
                  }
                  const parentScrollPanel = trackShell.closest('.scrolling-panel-container');
                  if (parentScrollPanel) {
                    parentScrollPanel.scroll(0,
                      parentScrollPanel.scrollTop + toScroll);
                  }
                }
              }
              globals.dispatch(
                  Actions.toggleTrackPinned({trackId: attrs.trackState.id}));
            },
            i: PIN,
            filledIcon: isPinned(attrs.trackState.id),
            tooltip: isPinned(attrs.trackState.id) ? 'Unpin' : 'Pin to top',
            showButton: isPinned(attrs.trackState.id),
            fullHeight: true,
          }),
          globals.state.currentSelection !== null &&
                  globals.state.currentSelection.kind === 'AREA' ?
              m(TrackButton, {
                action: (e: PerfettoMouseEvent) => {
                  globals.dispatch(Actions.toggleTrackInAreaSelection(
                      {id: attrs.trackState.id, isTrackGroup: false}));
                  e.stopPropagation();
                },
                i: isSelected(attrs.trackState.id) ? CHECKBOX : BLANK_CHECKBOX,
                tooltip: isSelected(attrs.trackState.id) ?
                    'Exclude track from area selection' :
                    'Include track in area selection',
                showButton: true,
              }) :
              ''));
  }

  resize = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    if (!this.attrs || !this.defaultHeight) {
      return;
    }
    resizeTrack(
      e,
      this.attrs.track,
      this.attrs.trackState,
      this.defaultHeight,
      this.attrs.pinnedCopy);
  };

  onmousemove(e: MouseEvent) {
    if (this.attrs?.track) {
      checkTrackForResizability(e, this.attrs.track, this.resize);
    }
  }
  onmouseleave(e: MouseEvent) {
    if (this.attrs?.track) {
      checkTrackForResizability(e, this.attrs.track, this.resize);
    }
  }

  ondragstart(e: DragEvent) {
      const dataTransfer = e.dataTransfer;
      if (dataTransfer === null) return;
      this.dragging = true;
      e.stopPropagation();
      globals.rafScheduler.scheduleFullRedraw();
        dataTransfer.effectAllowed = 'move';
        dataTransfer.setData('perfetto/track/' + this.attrs!.trackState.id, `${this.attrs!.trackState.id}`);
        dataTransfer.setDragImage(new Image(), 0, 0);
  }

  ondragend() {
    this.dragging = false;
    globals.rafScheduler.scheduleFullRedraw();
  }

  ondragover(e: DragEvent) {
    if (this.dragging) return;
    if (!(e.target instanceof HTMLElement)) return;
    const dataTransfer = e.dataTransfer;
    if (dataTransfer === null) return;
    const dataType = dataTransfer.types.find((dataType)=>{
      return dataType.startsWith('perfetto/track/');
    });
    if (!dataType) return;
    const trackLikeId = dataType.split('/').pop();
    if (!trackLikeId) return;
    e.stopPropagation();
    dataTransfer.dropEffect = 'move';
    e.preventDefault();

    // Test if id has same parent as current
    // If not do not set this.dropping
    const trackLike : TrackState | TrackGroupState =
      globals.state.trackGroups[trackLikeId] ??
        globals.state.tracks[trackLikeId];
    if (('trackGroup' in trackLike && this.attrs!.trackState.trackGroup === trackLike.trackGroup) ||
    'parentGroup' in trackLike && this.attrs!.trackState.trackGroup === trackLike.parentGroup) {
      // Apply some hysteresis to the drop logic so that the lightened border
      // changes only when we get close enough to the border.
      if (e.offsetY < e.target.scrollHeight / 3) {
        this.dropping = 'before';
      } else if (e.offsetY > e.target.scrollHeight / 3 * 2) {
        this.dropping = 'after';
      }
    }
    globals.rafScheduler.scheduleFullRedraw();
  }

  ondragleave() {
    this.dropping = undefined;
    globals.rafScheduler.scheduleFullRedraw();
  }

  ondrop(e: DragEvent) {
    if (this.dropping === undefined) return;
    const dataTransfer = e.dataTransfer;
    if (dataTransfer === null) return;
    globals.rafScheduler.scheduleFullRedraw();
    const dataType = dataTransfer.types.find((dataType)=>{
      return dataType.startsWith('perfetto/track/');
    });
    if (!dataType) return;
    const srcId = dataType.split('/').pop();
    if (!srcId) return;
    const dstId = this.attrs!.trackState.id;
    globals.dispatch(Actions.moveTrack({srcId, op: this.dropping, dstId}));
    this.dropping = undefined;
  }

  getTrackShellButtons(attrs: TrackShellAttrs): m.Vnode<TrackButtonAttrs>[] {
    const result = [...attrs.track.getTrackShellButtons()];
    result.push(m(TrackButton, {
      action: () => globals.dispatch(
        Actions.removeTrack({trackId: attrs.trackState.id})),
      i: 'hide',
      tooltip: 'Hide track',
      showButton: false, // Only show on roll-over
      fullHeight: true,
      disabled: !this.canDeleteTrack(attrs.trackState),
    }));
    return result;
  }

  // We cannot delete a track while it is loading, otherwise
  // we'll try to read data from tables that have been dropped.
  // We assume it may be loading if its engine is busy.
  protected canDeleteTrack(trackState: TrackState): boolean {
    const engine = globals.engines.get(trackState.engineId);
    return !engine || !engine.hasDataPending;
  }
}

export interface TrackContentAttrs { track: Track; }
export class TrackContent implements m.ClassComponent<TrackContentAttrs> {
  private mouseDownX?: number;
  private mouseDownY?: number;
  private selectionOccurred = false;

  view(node: m.CVnode<TrackContentAttrs>) {
    const attrs = node.attrs;
    return m(
        '.track-content',
        {
          onmousemove: (e: PerfettoMouseEvent) => {
            attrs.track.onMouseMove(
                {x: e.layerX - TRACK_SHELL_WIDTH, y: e.layerY});
            globals.rafScheduler.scheduleRedraw();
          },
          onmouseout: () => {
            attrs.track.onMouseOut();
            globals.rafScheduler.scheduleRedraw();
          },
          onmousedown: (e: PerfettoMouseEvent) => {
            this.mouseDownX = e.layerX;
            this.mouseDownY = e.layerY;
          },
          onmouseup: (e: PerfettoMouseEvent) => {
            if (this.mouseDownX === undefined ||
                this.mouseDownY === undefined) {
              return;
            }
            if (Math.abs(e.layerX - this.mouseDownX) > 1 ||
                Math.abs(e.layerY - this.mouseDownY) > 1) {
              this.selectionOccurred = true;
            }
            this.mouseDownX = undefined;
            this.mouseDownY = undefined;
          },
          onclick: (e: PerfettoMouseEvent) => {
            // This click event occurs after any selection mouse up/drag events
            // so we have to look if the mouse moved during this click to know
            // if a selection occurred.
            if (this.selectionOccurred) {
              this.selectionOccurred = false;
              return;
            }
            // Returns true if something was selected, so stop propagation.
            if (attrs.track.onMouseClick(
                    {x: e.layerX - TRACK_SHELL_WIDTH, y: e.layerY})) {
              e.stopPropagation();
            }
            globals.rafScheduler.scheduleRedraw();
          },
        },
        node.children);
  }
}

interface TrackComponentAttrs {
  trackState: TrackState;
  track: Track;
  pinnedCopy?: boolean;
}
class TrackComponent implements m.ClassComponent<TrackComponentAttrs> {
  view({attrs}: m.CVnode<TrackComponentAttrs>) {
    // TODO(hjd): The min height below must match the track_shell_title
    // max height in common.scss so we should read it from CSS to avoid
    // them going out of sync.
    return m(
        '.track',
        {
          style: {
            height: `${Math.max(18, attrs.track.getHeight())}px`,
          },
          id: 'track_' + attrs.trackState.id,
        },
        [
          m(TrackShell, {
            track: attrs.track,
            trackState: attrs.trackState,
            pinnedCopy: attrs.pinnedCopy}),
          m(TrackContent, {track: attrs.track}),
        ]);
  }

  oncreate({attrs}: m.CVnode<TrackComponentAttrs>) {
    if (globals.frontendLocalState.scrollToTrackId === attrs.trackState.id) {
      verticalScrollToTrack(attrs.trackState.id);
      globals.frontendLocalState.scrollToTrackId = undefined;
    }
  }
}

export interface TrackButtonAttrs {
  action: (e: PerfettoMouseEvent) => void;
  i: string;
  tooltip: string;
  showButton: boolean;
  fullHeight?: boolean;
  filledIcon?: boolean;
  disabled?: boolean;
}
export class TrackButton implements m.ClassComponent<TrackButtonAttrs> {
  view({attrs}: m.CVnode<TrackButtonAttrs>) {
    return m(
        'i.track-button',
        {
          class: [
            (attrs.showButton ? 'show' : ''),
            (attrs.fullHeight ? 'full-height' : ''),
            (attrs.filledIcon ? 'material-icons-filled' : 'material-icons'),
            (attrs.disabled) ? 'disabled' : '',
          ].filter(Boolean).join(' '),
          onclick: attrs.disabled ? null : attrs.action,
          title: attrs.tooltip,
        },
        attrs.i);
  }
}

interface TrackPanelAttrs {
  id: string;
  selectable: boolean;
  pinnedCopy?: boolean;
}

export class TrackPanel extends Panel<TrackPanelAttrs> {
  // TODO(hjd): It would be nicer if these could not be undefined here.
  // We should implement a NullTrack which can be used if the trackState
  // has disappeared.
  private track: Track|undefined;
  private trackState: TrackState|undefined;
  private pinnedCopy?: boolean;

  constructor(vnode: m.CVnode<TrackPanelAttrs>) {
    super();
    const trackId = vnode.attrs.id;
    this.pinnedCopy = vnode.attrs.pinnedCopy;
    const trackState = globals.state.tracks[trackId];
    if (trackState === undefined) {
      return;
    }
    const engine = globals.engines.get(trackState.engineId);
    if (engine === undefined) {
      return;
    }
    const trackCreator = trackRegistry.get(trackState.kind);
    this.track = trackCreator.create({trackId, engine});
    this.trackState = trackState;
  }

  view() {
    if (this.track === undefined || this.trackState === undefined) {
      return m('div', 'No such track');
    }
    return m(TrackComponent, {
      trackState: this.trackState,
      track: this.track,
      pinnedCopy: this.pinnedCopy});
  }

  oncreate() {
    if (this.track !== undefined) {
      this.track.onFullRedraw();
    }
  }

  onupdate() {
    if (this.track !== undefined) {
      this.track.onFullRedraw();
    }
  }

  onremove() {
    if (this.track !== undefined) {
      this.track.onDestroy();
      this.track = undefined;
    }
  }

  highlightIfTrackSelected(ctx: CanvasRenderingContext2D, size: PanelSize) {
    const {visibleTimeScale} = globals.frontendLocalState;
    const selection = globals.state.currentSelection;
    const trackState = this.trackState;
    if (!selection || selection.kind !== 'AREA' || trackState === undefined) {
      return;
    }
    const selectedArea = globals.state.areas[selection.areaId];
    const selectedAreaDuration = selectedArea.end - selectedArea.start;
    if (selectedArea.tracks.includes(trackState.id)) {
      ctx.fillStyle = getCssStr('--selection-fill-color');
      ctx.fillRect(
          visibleTimeScale.tpTimeToPx(selectedArea.start) + TRACK_SHELL_WIDTH,
          0,
          visibleTimeScale.durationToPx(selectedAreaDuration),
          size.height);
    }
  }

  renderCanvas(ctx: CanvasRenderingContext2D, size: PanelSize) {
    ctx.save();

    // If we have vsync data, render columns under the track and
    // under the grid lines painted next
    const vsync = getActiveVsyncData();
    if (vsync) {
      ctx.save();
      ctx.translate(TRACK_SHELL_WIDTH, 0);
      renderVsyncColumns(ctx, size.height, vsync);
      ctx.restore();
    }

    drawGridLines(
        ctx,
        size.width,
        size.height);

    ctx.translate(TRACK_SHELL_WIDTH, 0);
    if (this.track !== undefined) {
      this.track.render(ctx);
    }
    ctx.restore();

    this.highlightIfTrackSelected(ctx, size);

    const {visibleTimeScale} = globals.frontendLocalState;
    // Draw vertical line when hovering on the notes panel.
    if (globals.state.hoveredNoteTimestamp !== -1n) {
      drawVerticalLineAtTime(
          ctx,
          visibleTimeScale,
          globals.state.hoveredNoteTimestamp,
          size.height,
          `#aaa`);
    }
    if (globals.state.hoverCursorTimestamp !== -1n) {
      drawVerticalLineAtTime(
          ctx,
          visibleTimeScale,
          globals.state.hoverCursorTimestamp,
          size.height,
          `#344596`);
    }

    if (globals.state.currentSelection !== null) {
      if (globals.state.currentSelection.kind === 'SLICE' &&
          globals.sliceDetails.wakeupTs !== undefined) {
        drawVerticalLineAtTime(
            ctx,
            visibleTimeScale,
            globals.sliceDetails.wakeupTs,
            size.height,
            getCssStr('--main-foreground-color'));
      }
    }
    // All marked areas should have semi-transparent vertical lines
    // marking the start and end.
    for (const note of Object.values(globals.state.notes)) {
      if (note.noteType === 'AREA') {
        const transparentNoteColor =
            'rgba(' + hex.rgb(note.color.substr(1)).toString() + ', 0.65)';
        drawVerticalLineAtTime(
            ctx,
            visibleTimeScale,
            globals.state.areas[note.areaId].start,
            size.height,
            transparentNoteColor,
            1);
        drawVerticalLineAtTime(
            ctx,
            visibleTimeScale,
            globals.state.areas[note.areaId].end,
            size.height,
            transparentNoteColor,
            1);
      } else if (note.noteType === 'DEFAULT') {
        drawVerticalLineAtTime(
            ctx, visibleTimeScale, note.timestamp, size.height, note.color);
      }
    }
  }

  getSliceRect(tStart: TPTime, tDur: TPTime, depth: number): SliceRect
      |undefined {
    if (this.track === undefined) {
      return undefined;
    }
    return this.track.getSliceRect(tStart, tDur, depth);
  }
}
