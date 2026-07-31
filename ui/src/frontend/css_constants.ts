// Copyright (C) 2019 The Android Open Source Project
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

import {clamp} from '../base/math_utils';

// This code can be used in unittests where we can't read CSS variables.
// Also we cannot have global constructors because when the javascript is
// loaded, the CSS might not be ready yet.
export let TRACK_SHELL_WIDTH = 100;
export let DEFAULT_DETAILS_CONTENT_HEIGHT = 308;

// The name of the CSS variable that defines the track shell width. Its value on
// :root is the default width, i.e. TRACK_SHELL_WIDTH, and each timeline sets it
// on its own root element to lay its track shells out at the width of the
// workspace it is showing. See frontend/timeline_page/track_shell_width.ts.
export const TRACK_SHELL_WIDTH_VAR = '--track-shell-width';

// The fallback default track shell width, for when the CSS variable has not
// been read. Kept in step with common.scss.
export const DEFAULT_TRACK_SHELL_WIDTH = 250;

// Narrower than this and the track shell has no room for its buttons.
export const MIN_TRACK_SHELL_WIDTH = 100;

/**
 * Returns the widest the track shell may become, which is a fraction of the
 * window width, so that resizing it can never squash the timeline away
 * entirely.
 */
export function maxTrackShellWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_TRACK_SHELL_WIDTH;
  return Math.max(MIN_TRACK_SHELL_WIDTH, Math.floor(window.innerWidth / 2));
}

/**
 * Constrains a track shell width to the range the timeline can accommodate.
 *
 * @param px The desired width in pixels.
 * @returns The nearest usable whole number of pixels.
 */
export function clampTrackShellWidth(px: number): number {
  // Only integral values, as initCssConstants() cannot parse anything else.
  return Math.round(clamp(px, MIN_TRACK_SHELL_WIDTH, maxTrackShellWidth()));
}

export let FONT_COMPACT = '"Roboto Condensed", sans-serif';

export let COLOR_BORDER = 'hotpink';
export let COLOR_BORDER_SECONDARY = 'hotpink';
export let COLOR_BACKGROUND_SECONDARY = 'hotpink';
export let COLOR_ACCENT = 'hotpink';
export let COLOR_BACKGROUND = 'hotpink';
export let COLOR_TEXT = 'hotpink';
export let COLOR_TEXT_MUTED = 'hotpink';
export let COLOR_NEUTRAL = 'hotpink';
export let COLOR_HIGHLIGHT = 'hotpink';
export let COLOR_TIMELINE_OVERLAY = 'hotpink';

export function initCssConstants(element?: Element) {
  function getCssStr(prop: string): string | undefined {
    if (typeof window === 'undefined') return undefined;
    const searchElement = element ?? window.document.body;
    const value = window.getComputedStyle(searchElement).getPropertyValue(prop);
    // Note: getPropertyValue() returns an empty string if not set
    // https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleDeclaration/getPropertyValue#return_value
    return value === '' ? undefined : value;
  }

  function getCssNum(prop: string): number | undefined {
    const str = getCssStr(prop);
    if (str === undefined) return undefined;
    const match = str.match(/^\W*(\d+)px(|\!important')$/);
    if (!match) {
      throw Error(`Could not parse CSS property "${str}" as a number`);
    }
    return Number(match[1]);
  }

  TRACK_SHELL_WIDTH = getCssNum(TRACK_SHELL_WIDTH_VAR) ?? TRACK_SHELL_WIDTH;
  COLOR_BORDER = getCssStr('--pf-color-border') ?? COLOR_BORDER;
  COLOR_BORDER_SECONDARY =
    getCssStr('--pf-color-border-secondary') ?? COLOR_BORDER_SECONDARY;
  COLOR_BACKGROUND_SECONDARY =
    getCssStr('--pf-color-background-secondary') ?? COLOR_BACKGROUND_SECONDARY;
  COLOR_ACCENT = getCssStr('--pf-color-accent') ?? COLOR_ACCENT;
  DEFAULT_DETAILS_CONTENT_HEIGHT =
    getCssNum('--details-content-height') ?? DEFAULT_DETAILS_CONTENT_HEIGHT;
  COLOR_BACKGROUND = getCssStr('--pf-color-background') ?? COLOR_BACKGROUND;
  COLOR_TEXT = getCssStr('--pf-color-text') ?? COLOR_TEXT;
  FONT_COMPACT = getCssStr('--pf-font-compact') ?? FONT_COMPACT;
  COLOR_TEXT_MUTED = getCssStr('--pf-color-text-muted') ?? COLOR_TEXT_MUTED;
  COLOR_NEUTRAL = getCssStr('--pf-color-neutral') ?? COLOR_NEUTRAL;
  COLOR_HIGHLIGHT = getCssStr('--pf-color-highlight') ?? COLOR_HIGHLIGHT;
  COLOR_TIMELINE_OVERLAY =
    getCssStr('--pf-color-timeline-overlay') ?? COLOR_TIMELINE_OVERLAY;
}
