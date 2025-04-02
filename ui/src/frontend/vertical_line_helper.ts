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

import {Actions} from '../common';
import {TPTime} from '../common/time';
import {globals} from './globals';
import {TimeScale} from './time_scale';

export function drawVerticalLineAtTime(
    ctx: CanvasRenderingContext2D,
    timeScale: TimeScale,
    time: TPTime,
    height: number,
    color: string,
    lineWidth = 2) {
  const xPos =
    (globals.state.trackShellWidth) + Math.floor(timeScale.tpTimeToPx(time));
  drawVerticalLine(ctx, xPos, height, color, lineWidth);
}

export function resizeTrackShell(e: MouseEvent): void {
  e.stopPropagation();
  e.preventDefault();
  const preventClickEvent = (evClick: MouseEvent): void=>{
    evClick.stopPropagation();
    evClick.preventDefault();
    document.removeEventListener('click', preventClickEvent, true); // useCapture = true
  };
  // Use shell Width from state
  let currentWidth = globals.state.trackShellWidth;
  const mouseMoveEvent = (evMove: MouseEvent): void => {
    evMove.preventDefault();
    const container = document.querySelector('.pan-and-zoom-content');
    const newWidth = currentWidth + evMove.movementX;
    if (container && container instanceof HTMLElement
    ) {
      if (newWidth < 250) {
        globals.dispatch(Actions.setTrackShellWidth({newWidth: 250}));
      } else if (e.target &&
        newWidth > (container.clientWidth - 100)) {
          globals.dispatch(
            Actions.setTrackShellWidth({newWidth: container.clientWidth-100}));
      } else {
        globals.dispatch(Actions.setTrackShellWidth({newWidth}));
      }
      currentWidth = newWidth;
    }
  };
  const mouseUpEvent = (evUp : MouseEvent): void => {
    evUp.stopPropagation();
    evUp.preventDefault();
    document.removeEventListener('mousemove', mouseMoveEvent);
    document.removeEventListener('mouseup', mouseUpEvent);
  };
  document.addEventListener('click', preventClickEvent, true); // useCapture = true
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

