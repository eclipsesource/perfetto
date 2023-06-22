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

import {searchSegment} from '../base/binary_search';
import {Actions} from '../common/actions';
import {globals} from './globals';

function setToPrevious(globalsContext: string, current: number) {
  let index = current - 1;
  if (index < 0) {
    index = globals(globalsContext).currentSearchResults.totalResults - 1;
  }
  globals(globalsContext).dispatch(Actions.setSearchIndex({index}));
}

function setToNext(globalsContext: string, current: number) {
  const index =
      (current + 1) % globals(globalsContext).currentSearchResults.totalResults;
  globals(globalsContext).dispatch(Actions.setSearchIndex({index}));
}

export function executeSearch(globalsContext: string, reverse = false) {
  const index = globals(globalsContext).state.searchIndex;
  const vizWindow = globals(globalsContext).stateTraceTimeTP();
  const startNs = vizWindow.start;
  const endNs = vizWindow.end;
  const currentTs = globals(globalsContext).currentSearchResults.tsStarts[index];

  // If the value of |globals(globalsContext).currentSearchResults.totalResults| is 0,
  // it means that the query is in progress or no results are found.
  if (globals(globalsContext).currentSearchResults.totalResults === 0) {
    return;
  }

  // If this is a new search or the currentTs is not in the viewport,
  // select the first/last item in the viewport.
  if (index === -1 || currentTs < startNs || currentTs > endNs) {
    if (reverse) {
      const [smaller] =
          searchSegment(globals(globalsContext).currentSearchResults.tsStarts, endNs);
      // If there is no item in the viewport just go to the previous.
      if (smaller === -1) {
        setToPrevious(globalsContext, index);
      } else {
        globals(globalsContext).dispatch(Actions.setSearchIndex({index: smaller}));
      }
    } else {
      const [, larger] =
          searchSegment(globals(globalsContext).currentSearchResults.tsStarts, startNs);
      // If there is no item in the viewport just go to the next.
      if (larger === -1) {
        setToNext(globalsContext, index);
      } else {
        globals(globalsContext).dispatch(Actions.setSearchIndex({index: larger}));
      }
    }
  } else {
    // If the currentTs is in the viewport, increment the index.
    if (reverse) {
      setToPrevious(globalsContext, index);
    } else {
      setToNext(globalsContext, index);
    }
  }
  selectCurrentSearchResult(globalsContext);
}

function selectCurrentSearchResult(globalsContext: string) {
  const searchIndex = globals(globalsContext).state.searchIndex;
  const source = globals(globalsContext).currentSearchResults.sources[searchIndex];
  const currentId = globals(globalsContext).currentSearchResults.sliceIds[searchIndex];
  const trackId = globals(globalsContext).currentSearchResults.trackIds[searchIndex];

  if (currentId === undefined) return;

  if (source === 'cpu') {
    globals(globalsContext).dispatch(
        Actions.selectSlice({id: currentId, trackId, scroll: true}));
  } else if (source === 'log') {
    globals(globalsContext).dispatch(Actions.selectLog({id: currentId, trackId, scroll: true}));
  } else {
    // Search results only include slices from the slice table for now.
    // When we include annotations we need to pass the correct table.
    globals(globalsContext).dispatch(Actions.selectChromeSlice(
        {id: currentId, trackId, table: 'slice', scroll: true}));
  }
}
