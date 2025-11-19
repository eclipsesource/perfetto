// Copyright (C) 2019 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use size file except in compliance with the License.
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
import { assertUnreachable } from '../../base/logging';
import { TimeScale } from '../../base/time_scale';
import { raf } from '../../core/raf_scheduler';
import {Note, SpanNote} from '../../public/note';
import { TraceImpl } from 'src/core/trace_impl';

export interface NoteBadgeAttrs {
  timescale: TimeScale
  note: Note | SpanNote;
  xOffset?: number
  onClickBadge?: (note: Note | SpanNote) => unknown;
  onEnterBadge?: () => unknown;
  onLeaveBadge?: () => unknown;
}

function getBadgeTimestamp(note: Note | SpanNote) {
  const noteType = note.noteType;
  switch (noteType) {
    case 'SPAN':
      return note.end;
    case 'DEFAULT':
      return note.timestamp;
    default:
      assertUnreachable(noteType);
  }
}

export class NoteBadge implements m.ClassComponent<NoteBadgeAttrs>  {
  view({attrs, children}: m.Vnode<NoteBadgeAttrs>): m.Children {
    const { timescale, note, onEnterBadge, onLeaveBadge, onClickBadge } = attrs;
    const timestamp = getBadgeTimestamp(note);
    const xOffset = (attrs.xOffset ?? 0) + 8;
    const x = Math.floor(timescale.timeToPx(timestamp)) + xOffset;

    return m(
      '.pf-note-badge',
      {
        style: {
          left: `${x}px`,
          top: '-16px',
        },
        onmouseenter: () => {
          onEnterBadge?.();
        },
        onmouseleave: () => {
          onLeaveBadge?.();
        },
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          onClickBadge?.(attrs.note);
        },
        onmousedown: (e: MouseEvent) => {
          e.stopPropagation();
        },
      },
      children,
    );
  }
}

export class NoteDeleteBadgeState {
  private badgedNote: Note | SpanNote | undefined;
  private isBadgeHovered = false;
  private badgeDismissalTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly trace: TraceImpl) {}

  get hovered(): boolean {
    return this.isBadgeHovered;
  }

  updateHoveredNote(note: Note | SpanNote | null): void {
    if (note !== null && this.badgedNote !== note) {
      this.badgedNote = note;
      this.clearDismissal();
    } else if (!this.isBadgeHovered && this.badgedNote !== null) {
      // Schedule tooltip dismissal if neither note nor tooltip is hovered
      this.scheduleDismissal();
    }
  }

  render(timescale: TimeScale, xOffset?: number): m.Children {
    if (!this.badgedNote) {
      return null;
    }

    return m(NoteBadge,
        {
          timescale,
          note: this.badgedNote,
          xOffset,
          onEnterBadge: () => {
            this.isBadgeHovered = true;
            this.clearDismissal();
          },
          onLeaveBadge: () => {
            this.isBadgeHovered = false;
            // Schedule dismissal when leaving the badge
            this.scheduleDismissal();
          },
          onClickBadge: note => this.removeNote(note.id)
        },
        m('.pf-icon', '\uE5C9'), // Material Symbols Sharp "cancel" icon
      );
  }

  private scheduleDismissal(): void {
    if (this.badgeDismissalTimeout) {
      // Already scheduled
      return;
    }

    this.badgeDismissalTimeout = setTimeout(() => {
      this.badgedNote = undefined;
      this.badgeDismissalTimeout = undefined;
      raf.scheduleCanvasRedraw();
    }, 300);
  }

  private clearDismissal(): void {
    if (this.badgeDismissalTimeout) {
      clearTimeout(this.badgeDismissalTimeout);
      this.badgeDismissalTimeout = undefined;
    }
  }

  private removeNote(id: string) {
    this.trace.notes.removeNote(id);
    this.badgedNote = undefined;
    this.isBadgeHovered = false;
    this.clearDismissal();
    raf.scheduleCanvasRedraw();
  }
}
