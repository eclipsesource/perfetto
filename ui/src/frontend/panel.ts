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

import m from 'mithril';
import { GlobalsFunction, bindGlobals , HasGlobalsContextAttrs } from './globals';

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelAttrs extends HasGlobalsContextAttrs {}

export abstract class Panel<Attrs extends PanelAttrs = PanelAttrs> implements m.ClassComponent<Attrs> {
  protected readonly globals: GlobalsFunction;

  constructor({attrs}: m.CVnode<Attrs>) {
    this.globals = bindGlobals(attrs.globalsContext);
  }
  
  abstract renderCanvas(
      ctx: CanvasRenderingContext2D, size: PanelSize,
      vnode: PanelVNode<Attrs>): void;
  abstract view(vnode: m.CVnode<Attrs>): m.Children|null|void;
}


export type PanelVNode<Attrs extends PanelAttrs = PanelAttrs> = m.Vnode<Attrs, Panel<Attrs>>;

export function isPanelVNode(vnode: m.Vnode<any, any>): vnode is PanelVNode<PanelAttrs> {
  const tag = vnode.tag as {};
  return (
      typeof tag === 'function' && 'prototype' in tag &&
      tag.prototype instanceof Panel);
}
