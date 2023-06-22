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

import {Actions} from '../common/actions';

import {onClickCopy} from './clipboard';
import {CookieConsent} from './cookie_consent';
import {HasGlobalsContextAttrs, globals} from './globals';
import {fullscreenModalContainer} from './modal';
import {Sidebar} from './sidebar';
import {Topbar} from './topbar';

function renderPermalink(globalsContext: string): m.Children {
  const permalink = globals(globalsContext).state.permalink;
  if (!permalink.requestId || !permalink.hash) return null;
  const url = `${self.location.origin}/#!/?s=${permalink.hash}`;
  const linkProps = {title: 'Click to copy the URL', onclick: onClickCopy(globalsContext, url)};

  return m('.alert-permalink', [
    m('div', 'Permalink: ', m(`a[href=${url}]`, linkProps, url)),
    m('button',
      {
        onclick: () => globals(globalsContext).dispatch(Actions.clearPermalink({})),
      },
      m('i.material-icons.disallow-selection', 'close')),
  ]);
}

class Alerts implements m.ClassComponent<HasGlobalsContextAttrs> {
  view(vnode: m.Vnode<HasGlobalsContextAttrs>): void | m.Children {
    const globalsContext = vnode.attrs.globalsContext;
    return m('.alerts', renderPermalink(globalsContext));
  }
}

// Wrap component with common UI elements (nav bar etc).
export function createPage(component: m.Component<PageAttrs>):
    m.Component<PageAttrs> {
  const pageComponent = {
    view({attrs}: m.Vnode<PageAttrs>) {
      const globalsContext = attrs.globalsContext;
      const children = [
        m(Sidebar, attrs),
        m(Topbar, attrs),
        m(Alerts, attrs),
        m(component, attrs),
        m(CookieConsent, attrs),
        m(fullscreenModalContainer.mithrilComponent),
      ];
      if (globals(globalsContext).state.perfDebug) {
        children.push(m('.perf-stats'));
      }
      return m('div.perfetto',children);
    },
  };

  return pageComponent;
}

export interface PageAttrs extends HasGlobalsContextAttrs {
  subpage?: string;
}
