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

import {
  DEFAULT_TRACK_SHELL_WIDTH,
  MIN_TRACK_SHELL_WIDTH,
} from '../css_constants';
import {Trace} from '../../public/trace';
import {Workspace} from '../../public/workspace';
import {
  applyTrackShellWidth,
  fittedTrackShellWidth,
  trackShellWidth,
  updateTrackShellWidth,
} from './track_shell_width';

// Just enough of a trace and its timeline page for the track shell width. The
// page element is attached, as a timeline that is not on screen is left alone.
function fakeTimeline(workspace = new Workspace()) {
  const trace = {currentWorkspace: workspace} as unknown as Trace;
  const element = document.createElement('div');
  document.body.appendChild(element);
  return {trace, workspace, element};
}

// The width the timeline lays its track shells out at.
function laidOutWidth(element: HTMLElement) {
  return element.style.getPropertyValue('--track-shell-width');
}

describe('track shell width of a workspace', () => {
  it('is the default width until set', () => {
    const {trace, workspace, element} = fakeTimeline();
    expect(workspace.trackShellWidth).toBeUndefined();

    applyTrackShellWidth(trace, element);

    expect(trackShellWidth(workspace)).toBe(DEFAULT_TRACK_SHELL_WIDTH);
    expect(laidOutWidth(element)).toBe(`${DEFAULT_TRACK_SHELL_WIDTH}px`);
  });

  it('is applied to the timeline showing it', () => {
    const {trace, workspace, element} = fakeTimeline();
    workspace.trackShellWidth = 400;

    applyTrackShellWidth(trace, element);

    expect(laidOutWidth(element)).toBe('400px');
  });

  it('records the width that was applied', () => {
    const {trace, workspace, element} = fakeTimeline();
    applyTrackShellWidth(trace, element);

    updateTrackShellWidth(trace, MIN_TRACK_SHELL_WIDTH - 50);

    expect(workspace.trackShellWidth).toBe(MIN_TRACK_SHELL_WIDTH);
    expect(laidOutWidth(element)).toBe(`${MIN_TRACK_SHELL_WIDTH}px`);
  });

  it('can be narrowed again after being widened', () => {
    // Regression test: applying the stored width on every render used to
    // restore the last width the user had settled on, which made narrowing the
    // column impossible.
    const {trace, workspace, element} = fakeTimeline();
    applyTrackShellWidth(trace, element);
    updateTrackShellWidth(trace, 400);

    updateTrackShellWidth(trace, 300);
    applyTrackShellWidth(trace, element);

    expect(workspace.trackShellWidth).toBe(300);
    expect(laidOutWidth(element)).toBe('300px');
  });

  it('follows the workspace on show', () => {
    const {trace, workspace, element} = fakeTimeline();
    const another = new Workspace();
    another.trackShellWidth = 300;
    updateTrackShellWidth(trace, 400);

    (trace as {currentWorkspace: Workspace}).currentWorkspace = another;
    applyTrackShellWidth(trace, element);

    expect(laidOutWidth(element)).toBe('300px');
    expect(workspace.trackShellWidth).toBe(400);
  });

  it('is applied to one timeline only, not to every open trace', () => {
    // Regression test: the width used to be applied globally, so resizing the
    // track shell of one trace resized the track shells of all open traces,
    // and only the trace whose page rendered last kept its own width.
    const one = fakeTimeline();
    const another = fakeTimeline();
    applyTrackShellWidth(one.trace, one.element);
    applyTrackShellWidth(another.trace, another.element);

    updateTrackShellWidth(one.trace, 400);

    expect(laidOutWidth(one.element)).toBe('400px');
    expect(laidOutWidth(another.element)).toBe(
      `${DEFAULT_TRACK_SHELL_WIDTH}px`,
    );
    expect(another.workspace.trackShellWidth).toBeUndefined();
  });

  it('can be resized on any open trace, not just the last one rendered', () => {
    const one = fakeTimeline();
    const another = fakeTimeline();
    applyTrackShellWidth(one.trace, one.element);
    applyTrackShellWidth(another.trace, another.element);

    updateTrackShellWidth(one.trace, 400);
    updateTrackShellWidth(another.trace, 300);
    // Both pages re-render, as they do on every redraw.
    applyTrackShellWidth(one.trace, one.element);
    applyTrackShellWidth(another.trace, another.element);

    expect(laidOutWidth(one.element)).toBe('400px');
    expect(laidOutWidth(another.element)).toBe('300px');
  });

  it('is left alone once its timeline is gone', () => {
    const {trace, workspace, element} = fakeTimeline();
    applyTrackShellWidth(trace, element);

    element.remove();
    updateTrackShellWidth(trace, 400);

    // The width is still recorded, ready for the next timeline to show it.
    expect(workspace.trackShellWidth).toBe(400);
    expect(laidOutWidth(element)).toBe(`${DEFAULT_TRACK_SHELL_WIDTH}px`);
  });
});

describe('fittedTrackShellWidth', () => {
  it('leaves the width alone when no tracks are rendered', () => {
    expect(fittedTrackShellWidth(250, [])).toBe(250);
  });

  it('leaves the width alone when all names fit', () => {
    expect(fittedTrackShellWidth(250, [0, 0, 0])).toBe(250);
  });

  it('never returns a width narrower than the minimum', () => {
    expect(fittedTrackShellWidth(10, [])).toBe(MIN_TRACK_SHELL_WIDTH);
  });

  it('grows by the worst truncation, plus padding', () => {
    expect(fittedTrackShellWidth(250, [12, 140, 37])).toBe(250 + 140 + 4);
  });

  it('ignores names that are not truncated', () => {
    // Titles that fit can report a small negative deficit.
    expect(fittedTrackShellWidth(250, [-2, 0, 60])).toBe(250 + 60 + 4);
    expect(fittedTrackShellWidth(250, [-2, -7])).toBe(250);
  });
});
