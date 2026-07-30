// Copyright (C) 2026 The Android Open Source Project
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

/**
 * Manages the width of the track shell (i.e. the track name column) of the
 * timeline, which the user can resize by dragging the divider between the track
 * names and the timeline, or fit to the names of the tracks on screen.
 *
 * Widening the column is what makes long track names readable, rather than
 * truncated to a common prefix that leaves tracks hard to tell apart.
 *
 * The width is a property of the workspace, because it is the tracks that a
 * workspace shows that determine how much room their names need. Embedders that
 * persist workspaces persist the width along with them.
 *
 * Everything here is scoped to one timeline, because an embedder can have a
 * timeline page mounted for each of several open traces, all of which are
 * re-rendered together. Each timeline lays out its own track shells using the
 * CSS variable on its own root element, and draws its canvas at the width of
 * the workspace it is showing.
 */

import {raf} from '../../core/raf_scheduler';
import type {Trace} from '../../public/trace';
import {Workspace} from '../../public/workspace';
import {
  clampTrackShellWidth,
  DEFAULT_TRACK_SHELL_WIDTH,
  MIN_TRACK_SHELL_WIDTH,
  TRACK_SHELL_WIDTH_VAR,
} from '../css_constants';

// A little breathing room, so that fitted names don't touch the divider.
const FIT_PADDING_PX = 4;

// Each track title carries a popup holding the whole name at its natural width,
// which the track shell shows on hover when the name doesn't fit. Comparing the
// two is how much wider the title needs to be to show the name in full.
//
// Note that measuring the ellipsized text itself would not do: the widget always
// shows the last few characters of the name, at a fixed width, so once the title
// is narrower than those the ellipsized text can no longer say how much room the
// rest of the name needs. That is the case for indented tracks and for tracks
// with chips, whose titles have the least room of all.
const TRACK_TITLE_SELECTOR = '.pf-track__title';
const TRACK_TITLE_POPUP_SELECTOR = '.pf-track__title-popup';

// The root element of the timeline page showing each workspace, so that a resize
// can be applied to the timeline it was made on, and no other.
//
// This is keyed by workspace rather than by trace because plugins - and so the
// commands they register - are handed a proxy of the trace, which is not the
// same object as the one the timeline page renders. Workspaces are shared, so
// they are the same object either way.
const timelines = new WeakMap<Workspace, HTMLElement>();

// Returns the timeline showing a trace, or undefined if it has none on screen.
function timelineFor(trace: Trace): HTMLElement | undefined {
  const timeline = timelines.get(trace.currentWorkspace);
  // A timeline page that has been removed can neither be laid out nor measured.
  return timeline?.isConnected ? timeline : undefined;
}

/**
 * Returns the width of the track shell to show a workspace at, which is the
 * default width for a workspace whose width the user has not set.
 *
 * This is the width that the canvas rendering code of a timeline must use, as
 * the timeline lays out its track shells at this width.
 *
 * Note that the default is DEFAULT_TRACK_SHELL_WIDTH rather than
 * TRACK_SHELL_WIDTH: the latter is only read from the stylesheet if the
 * embedder calls initCssConstants(), and a timeline must lay its track shells
 * out at a sensible width either way.
 *
 * @param workspace The workspace being shown.
 * @returns The width in pixels.
 */
export function trackShellWidth(workspace: Workspace): number {
  return clampTrackShellWidth(
    workspace.trackShellWidth ?? DEFAULT_TRACK_SHELL_WIDTH,
  );
}

/**
 * Lays out the timeline of a trace at the track shell width of the workspace it
 * is showing, and remembers it as that trace's timeline. Called on every render
 * of the timeline page, so that the timeline follows the workspace, including
 * after switching workspaces.
 *
 * @param trace The trace whose timeline is being shown.
 * @param timeline The root element of the timeline page showing the trace.
 */
export function applyTrackShellWidth(trace: Trace, timeline: HTMLElement) {
  timelines.set(trace.currentWorkspace, timeline);
  const width = `${trackShellWidth(trace.currentWorkspace)}px`;
  // Setting the same value again is a no-op, so this is safe to call on every
  // render.
  if (timeline.style.getPropertyValue(TRACK_SHELL_WIDTH_VAR) !== width) {
    timeline.style.setProperty(TRACK_SHELL_WIDTH_VAR, width);
    raf.scheduleCanvasRedraw();
  }
}

/**
 * Sets the track shell width of the workspace that a trace is showing, and lays
 * its timeline out at the new width.
 *
 * @param trace The trace whose timeline is being resized.
 * @param px The desired width in pixels.
 */
export function updateTrackShellWidth(trace: Trace, px: number) {
  // Store the width that will actually be applied, so that the workspace and
  // the timeline can never disagree.
  trace.currentWorkspace.trackShellWidth = clampTrackShellWidth(px);

  const timeline = timelineFor(trace);
  if (timeline) {
    // Lay the timeline out now rather than waiting for the next render, so that
    // dragging the divider doesn't need to re-render the whole page per frame.
    applyTrackShellWidth(trace, timeline);
  } else {
    // The timeline showing this workspace has yet to render, so leave it to
    // pick the width up when it does.
    raf.scheduleFullRedraw();
  }
}

/**
 * Widens the track shell of the timeline of a trace to fit the names of the
 * tracks it currently has rendered. Never narrows it: the tracks on screen are a
 * moving target, so narrowing would truncate names elsewhere in the workspace.
 *
 * @param trace The trace whose timeline is being fitted.
 */
export function fitTrackShellWidth(trace: Trace) {
  const timeline = timelineFor(trace);
  if (!timeline) return;

  // Note that the timeline only renders the tracks in (or near) the viewport, so
  // this fits the names of the tracks on screen rather than those of every track
  // in the workspace: what the user can see is what they are asking to fit, and
  // it keeps the cost proportional to what is visible.
  //
  // Only this timeline's tracks are measured: those of the timelines of other
  // open traces are not laid out, and would report their whole name truncated.
  const titles = timeline.querySelectorAll(TRACK_TITLE_SELECTOR);
  const fitted = fittedTrackShellWidth(
    trackShellWidth(trace.currentWorkspace),
    Array.from(titles, trackTitleShortfall),
  );

  updateTrackShellWidth(trace, fitted);
}

/**
 * Measures how much wider a track title needs to be to show its whole name.
 *
 * @param title A track title element.
 * @returns The shortfall in pixels, zero or less for a name that fits.
 */
function trackTitleShortfall(title: Element): number {
  const wholeName = title.querySelector(TRACK_TITLE_POPUP_SELECTOR);
  if (!wholeName) return 0;
  return wholeName.clientWidth - title.clientWidth;
}

/**
 * Computes the track shell width needed to show the whole name of every track of
 * a timeline. Factored out of fitTrackShellWidth() for testability.
 *
 * @param currentWidth The current width of the track shell, in pixels.
 * @param shortfallPx The number of pixels by which each rendered track title
 * falls short of showing its whole name, zero or less for names that fit.
 * @returns The required width in pixels.
 */
export function fittedTrackShellWidth(
  currentWidth: number,
  shortfallPx: ReadonlyArray<number>,
): number {
  // A name that fits reports zero, or a little less than zero.
  const worst = Math.max(0, ...shortfallPx);
  if (worst === 0) return Math.max(currentWidth, MIN_TRACK_SHELL_WIDTH);
  return currentWidth + worst + FIT_PADDING_PX;
}
