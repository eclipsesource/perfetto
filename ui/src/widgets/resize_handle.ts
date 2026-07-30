// Copyright (C) 2025 The Android Open Source Project
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
import {classNames} from '../base/classnames';
import {HTMLAttrs} from './common';
import {MithrilEvent} from '../base/mithril_utils';

// Whether the handle resizes an element vertically (i.e. it is dragged up and
// down) or horizontally (i.e. it is dragged left and right).
export type ResizeHandleOrientation = 'vertical' | 'horizontal';

export interface ResizeHandleAttrs extends HTMLAttrs {
  // Defaults to 'vertical'.
  readonly orientation?: ResizeHandleOrientation;
  onResize(deltaPx: number): void;
  onResizeStart?(): void;
  onResizeEnd?(): void;
}

export class ResizeHandle implements m.ClassComponent<ResizeHandleAttrs> {
  private handleElement?: HTMLElement;
  private previousPos: number | undefined;

  oncreate(vnode: m.VnodeDOM<ResizeHandleAttrs, this>) {
    this.handleElement = vnode.dom as HTMLElement;
  }

  private endDrag(attrs: ResizeHandleAttrs, pointerId: number) {
    if (this.previousPos !== undefined) {
      this.previousPos = undefined;
      this.handleElement!.releasePointerCapture(pointerId);
      attrs.onResizeEnd?.();
    }
  }

  // Returns the pointer position along the axis this handle is dragged on,
  // relative to the element the handle is positioned within.
  private pointerPos(e: PointerEvent, orientation: ResizeHandleOrientation) {
    const offsetParent = this.handleElement?.offsetParent as HTMLElement;
    const parentRect = offsetParent?.getBoundingClientRect();
    if (orientation === 'horizontal') {
      return e.clientX - (parentRect?.left ?? 0);
    } else {
      return e.clientY - (parentRect?.top ?? 0);
    }
  }

  view({attrs}: m.CVnode<ResizeHandleAttrs>): m.Children {
    const {
      orientation = 'vertical',
      onResize: _onResize,
      onResizeStart: _onResizeStart,
      onResizeEnd: _onResizeEnd,
      className,
      ...rest
    } = attrs;

    return m('.pf-resize-handle', {
      className: classNames(
        orientation === 'horizontal' && 'pf-resize-handle--horizontal',
        className,
      ),
      oncontextmenu: (e: Event) => {
        e.preventDefault();
      },
      onpointerdown: (e: PointerEvent) => {
        this.previousPos = this.pointerPos(e, orientation);

        this.handleElement!.setPointerCapture(e.pointerId);
        attrs.onResizeStart?.();
      },
      onpointermove: (e: MithrilEvent<PointerEvent>) => {
        const pos = this.pointerPos(e, orientation);

        // We typically just resize some element when dragging the handle, so we
        // tell Mithril not to redraw after this event.
        e.redraw = false;
        if (
          this.previousPos !== undefined
          // && this.handleElement!.hasPointerCapture(e.pointerId)
        ) {
          attrs.onResize(pos - this.previousPos);
          this.previousPos = pos;
        }
      },
      onpointerup: (e: PointerEvent) => {
        this.endDrag(attrs, e.pointerId);
      },
      onpointercancel: (e: PointerEvent) => {
        this.endDrag(attrs, e.pointerId);
      },
      onpointercapturelost: (e: PointerEvent) => {
        this.endDrag(attrs, e.pointerId);
      },
      ...rest,
    });
  }
}
