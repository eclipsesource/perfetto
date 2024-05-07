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

import {TPTime} from '../common/time';
import {getCssNum} from './css_constants';
import {globals} from './globals';
import {TimeScale} from './time_scale';

export function drawVerticalLineAtTime(
    ctx: CanvasRenderingContext2D,
    timeScale: TimeScale,
    time: TPTime,
    height: number,
    color: string,
    lineWidth = 2) {
  const xPos = (getCssNum('--track-shell-width') || 0) + Math.floor(timeScale.tpTimeToPx(time));
  drawVerticalLine(ctx, xPos, height, color, lineWidth);
}

export function resizeTrackShell(e: MouseEvent): void {
  e.stopPropagation();
  e.preventDefault();
  const mouseMoveEvent = (evMove: MouseEvent): void => {
      evMove.preventDefault();
      const root = document.querySelector(':root');
      if (root && root instanceof HTMLElement &&
          'layerX' in evMove && evMove.layerX &&
          typeof evMove.layerX === 'number'
      ) {
        if (evMove.layerX < 250) {
          root.style.setProperty('--track-shell-width', '250px');
        } else if (e.target &&
          e.target instanceof HTMLElement &&
          evMove.layerX > (e.target.clientWidth - 100)) {
            root.style.setProperty('--track-shell-width', e.target.clientWidth-100 + 'px');
        } else {
          root.style.setProperty('--track-shell-width', evMove.layerX + 'px');
        }
        globals.rafScheduler.scheduleFullRedraw();
      }
  };
  const mouseUpEvent = (evUp : MouseEvent): void => {
      evUp.stopPropagation();
      evUp.preventDefault();
      document.removeEventListener('mousemove', mouseMoveEvent);
      document.removeEventListener('mouseup', mouseUpEvent);
  };
  document.addEventListener('mousemove', mouseMoveEvent);
  document.addEventListener('mouseup', mouseUpEvent);
  document.removeEventListener('mousedown', resizeTrackShell);
};

function drawVerticalLine(ctx: CanvasRenderingContext2D,
                          xPos: number,
                          height: number,
                          color: string,
                          lineWidth = 2) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    const prevLineWidth = ctx.lineWidth;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(xPos, 0);
    ctx.lineTo(xPos, height);
    ctx.stroke();
    ctx.closePath();
    ctx.lineWidth = prevLineWidth;
}

