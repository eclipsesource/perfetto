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

import {test, expect, Browser, Locator, Page} from '@playwright/test';
import {assertExists} from '../base/logging';
import {PerfettoTestHelper} from './perfetto_ui_test_helper';

test.describe.configure({mode: 'parallel'});

const TRACE = 'api34_startup_cold.perfetto-trace';
const HANDLE = '.pf-timeline-page__track-shell-resize-handle';

// Opens a trace and waits for its timeline to be showing tracks. Note that the
// helper's openTraceFile() can return before that, and that the timeline page
// renders while the trace is still loading, with its tracks hidden: a track name
// column with no track names in it fits and resizes to nothing.
async function openTimeline(browser: Browser) {
  const page = await browser.newPage();
  const pth = new PerfettoTestHelper(page);
  await pth.openTraceFile(TRACE);
  const timeline = page.locator('.pf-timeline-page');
  await timeline.locator('.pf-track__title').first().waitFor();
  return {page, timeline};
}

// Where the divider sits, as offsets from the left hand edge of the timeline,
// which is where the track shells start. Bounding boxes are in page coordinates,
// so they include everything to the left of the timeline, such as the sidebar.
async function dividerBounds(timeline: Locator) {
  const handle = timeline.locator(HANDLE);
  const timelineBox = assertExists(await timeline.boundingBox());
  const handleBox = assertExists(await handle.boundingBox());
  const left = handleBox.x - timelineBox.x;
  return {left, right: left + handleBox.width};
}

// The width of the track name column, as the DOM parts of the timeline see it.
// Each timeline lays its track shells out at its own width, so this is read from
// the timeline rather than from the document.
function trackShellWidth(timeline: Locator): Promise<number> {
  return timeline.evaluate((el) =>
    parseInt(getComputedStyle(el).getPropertyValue('--track-shell-width')),
  );
}

// The number of pixels by which the name of each track of this timeline falls
// short of being shown in full, zero or less for names that fit. Each title
// carries a popup holding the whole name at its natural width, which is what
// makes this measurable.
function titleShortfalls(timeline: Locator): Promise<number[]> {
  return timeline.evaluate((el) =>
    Array.from(el.querySelectorAll('.pf-track__title'), (title) => {
      const wholeName = title.querySelector('.pf-track__title-popup');
      return wholeName ? wholeName.clientWidth - title.clientWidth : 0;
    }),
  );
}

// The track shell width commands are scoped to the trace, so they have to be run
// on the trace's command manager rather than the app's.
function runTraceCommand(
  page: Page,
  id: string,
  ...args: unknown[]
): Promise<void> {
  return page.evaluate(
    (arg) => {
      const trace = self.app.trace;
      if (!trace) throw new Error('No trace loaded');
      trace.commands.runCommand(arg.id, ...arg.args);
    },
    {id, args},
  );
}

function currentWorkspaceTitle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const trace = self.app.trace;
    if (!trace) throw new Error('No trace loaded');
    return trace.workspaces.currentWorkspace.title;
  });
}

// Switching workspaces goes through the command rather than the workspace
// manager, as the command schedules the redraw that shows the new workspace.
function switchWorkspace(page: Page, title: string): Promise<void> {
  return runTraceCommand(page, 'dev.perfetto.SwitchWorkspace', title);
}

// Drags the divider by the given number of pixels, positive to the right.
async function dragDivider(timeline: Locator, deltaPx: number) {
  const handle = timeline.locator(HANDLE);
  await handle.waitFor();
  const box = assertExists(await handle.boundingBox());
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const mouse = timeline.page().mouse;
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x + deltaPx, y, {steps: 10});
  await mouse.up();
}

test('dragging the divider resizes the track name column', async ({
  browser,
}) => {
  const {timeline} = await openTimeline(browser);

  const initialWidth = await trackShellWidth(timeline);

  // The divider straddles the boundary between the track shells and the
  // timeline, so the boundary lies within it.
  const initialBounds = await dividerBounds(timeline);
  expect(initialBounds.left).toBeLessThanOrEqual(initialWidth);
  expect(initialBounds.right).toBeGreaterThanOrEqual(initialWidth);

  await dragDivider(timeline, 150);

  await expect.poll(() => trackShellWidth(timeline)).toBe(initialWidth + 150);

  // The tracks and the divider follow the new width.
  const shell = timeline.locator('.pf-track__shell').first();
  await expect
    .poll(async () => assertExists(await shell.boundingBox()).width)
    .toBeCloseTo(initialWidth + 150, 0);
  await expect
    .poll(async () => (await dividerBounds(timeline)).left)
    .toBeCloseTo(initialBounds.left + 150, 0);
});

test('fitting the track name column reveals the full track names', async ({
  browser,
}) => {
  const {page, timeline} = await openTimeline(browser);

  const initialWidth = await trackShellWidth(timeline);
  // This trace has track names that don't fit at the default width, otherwise
  // there would be nothing here to fit.
  expect(Math.max(0, ...(await titleShortfalls(timeline)))).toBeGreaterThan(0);

  await runTraceCommand(page, 'dev.perfetto.FitTrackShellWidth');

  await expect
    .poll(() => trackShellWidth(timeline))
    .toBeGreaterThan(initialWidth);
  const fittedWidth = await trackShellWidth(timeline);

  const widestAllowed = Math.floor(
    (await page.evaluate(() => window.innerWidth)) / 2,
  );
  if (fittedWidth < widestAllowed) {
    // Every name of a track on screen is shown in full, in one go: fitting is
    // not expected to need a second attempt to get there.
    await expect
      .poll(async () => Math.max(0, ...(await titleShortfalls(timeline))))
      .toBe(0);
  } else {
    // The names need more room than the timeline can give up.
    expect(fittedWidth).toBe(widestAllowed);
  }

  // A fitted column can still be narrowed again.
  await dragDivider(timeline, -100);
  await expect.poll(() => trackShellWidth(timeline)).toBe(fittedWidth - 100);
});

test('the track name column width can be set exactly', async ({browser}) => {
  const {page, timeline} = await openTimeline(browser);

  await runTraceCommand(page, 'dev.perfetto.SetTrackShellWidth', 400);
  await expect.poll(() => trackShellWidth(timeline)).toBe(400);

  // Widths that would leave no room for the timeline are clamped.
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  await runTraceCommand(
    page,
    'dev.perfetto.SetTrackShellWidth',
    viewportWidth * 2,
  );
  await expect
    .poll(() => trackShellWidth(timeline))
    .toBeLessThanOrEqual(viewportWidth / 2);
});

test('each workspace has its own track name column width', async ({
  browser,
}) => {
  const {page, timeline} = await openTimeline(browser);

  const defaultWidth = await trackShellWidth(timeline);
  const originalWorkspace = await currentWorkspaceTitle(page);
  await runTraceCommand(page, 'dev.perfetto.SetTrackShellWidth', 400);
  await expect.poll(() => trackShellWidth(timeline)).toBe(400);

  // A new workspace starts at the default width...
  await runTraceCommand(
    page,
    'dev.perfetto.CreateWorkspaceAndSwitch',
    'Wide Names',
  );
  await expect.poll(() => trackShellWidth(timeline)).toBe(defaultWidth);

  await runTraceCommand(page, 'dev.perfetto.SetTrackShellWidth', 500);
  await expect.poll(() => trackShellWidth(timeline)).toBe(500);

  // ...and switching back restores the width of the original workspace.
  await switchWorkspace(page, originalWorkspace);
  await expect.poll(() => trackShellWidth(timeline)).toBe(400);
});
