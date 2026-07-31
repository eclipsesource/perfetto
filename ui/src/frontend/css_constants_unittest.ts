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
  clampTrackShellWidth,
  maxTrackShellWidth,
  MIN_TRACK_SHELL_WIDTH,
} from './css_constants';

describe('clampTrackShellWidth', () => {
  it('leaves a usable width alone', () => {
    expect(clampTrackShellWidth(300)).toBe(300);
  });

  it('clamps to the minimum width', () => {
    expect(clampTrackShellWidth(MIN_TRACK_SHELL_WIDTH - 50)).toBe(
      MIN_TRACK_SHELL_WIDTH,
    );
  });

  it('clamps to the maximum width, so the timeline is never squashed away', () => {
    const max = maxTrackShellWidth();
    expect(max).toBeLessThan(window.innerWidth);
    expect(clampTrackShellWidth(window.innerWidth * 2)).toBe(max);
  });

  it('rounds to whole pixels, as initCssConstants() cannot parse others', () => {
    expect(clampTrackShellWidth(300.4)).toBe(300);
  });
});
