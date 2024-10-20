// Copyright (C) 2022 The Android Open Source Project
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

import {TrackFilter, TrackGroupFilter} from 'src/controller/track_filter';
import {EngineProxy} from '../common/engine';
import {TrackControllerFactory} from '../controller/track_controller';
import {TrackCreator} from '../frontend/track';
import {Selection} from './state';
import {CustomButtonArgs} from '../frontend/button_registry';

export {EngineProxy} from '../common/engine';
export {
  LONG,
  LONG_NULL,
  NUM,
  NUM_NULL,
  STR,
  STR_NULL,
} from '../common/query_result';

export interface TrackInfo {
  // The id of this 'type' of track. This id is used to select the
  // correct |TrackCreator| to construct the track.
  trackKind: string;

  // A human readable name for this specific track. It will normally be
  // displayed on the left-hand-side of the track.
  name: string;

  // An optional human readable description for this specific track.
  // If provided, it will be included in the hover tooltip on the
  // track name on the left-hand side of the track.
  description?: string;

  // An optional human readable group name for this track.
  // Tracks of the same group name are collected into a group of that name.
  group?: string;

  // SOKATOA: support specifying a sequence/hierarchy of groups, as an
  // alternative to specifying just a single one. This way, the plugin
  // can create a track in an arbitrarily nested group.
  // This property is ignored if |group| is defined.
  //
  // All elements in the array are group names, never a group ID, not even
  // a group ID constant (e.g., SCROLLING_TRACKS).
  groups?: string[];

  // An opaque config for the track.
  config: {};
}

// Called any time a trace is loaded. Plugins should return all
// potential tracks. Zero or more of the provided tracks may be
// instantiated depending on the users choices.
export type TrackProvider = (engine: EngineProxy) => Promise<TrackInfo[]>;

// The public API plugins use to extend the UI. This is passed to each
// plugin via the exposed 'activate' function.
export interface PluginContext {
  // DEPRECATED. In prior versions of the UI tracks were split into a
  // 'TrackController' and a 'Track'. In more recent versions of the UI
  // the functionality of |TrackController| has been merged into Track so
  // |TrackController|s are not necessary in new code.
  // Unless |supersede| is true, then an attempt to register a |track|
  // controller factory for a |track| kind that is already registered will
  // throw an error.
  registerTrackController(track: TrackControllerFactory,
    supersede?: boolean): void;

  // Register a |TrackProvider|. |TrackProvider|s return |TrackInfo| for
  // all potential tracks in a trace. The core UI selects some of these
  // |TrackInfo|s and constructs concrete Track instances using the
  // registered |TrackCreator|s.
  registerTrackProvider(provider: TrackProvider): void;

  // Register a track factory. The core UI invokes |TrackCreator| to
  // construct tracks discovered by invoking |TrackProvider|s.
  // The split between 'construction' and 'discovery' allows
  // plugins to reuse common tracks for new data. For example: the
  // dev.perfetto.AndroidGpu plugin could register a TrackProvider
  // which returns GPU counter tracks. The counter track factory itself
  // could be registered in dev.perfetto.CounterTrack - a whole
  // different plugin.
  // Unless |supersede| is true, then an attempt to register a |track|
  // controller factory for a |track| kind that is already registered will
  // throw an error.
  registerTrack(track: TrackCreator, supersede?: boolean): void;

  // Register a track or track group filter. When track filtering is
  // enabled, the core UI determines via the registered filters which
  // tracks and track groups to show and which to suppress.
  // Filtered tracks and track groups may later be created and
  // shown, in which case they present a trash-can button to hide them
  // once again.
  registerTrackFilter(filter: TrackFilter | TrackGroupFilter): void;

  // Register custom functionality to specify how the plugin should handle
  // selection changes for tracks in this plugin.
  //
  // Params:
  // @onDetailsPanelSelectionChange a function that takes a Selection as its
  // parameter and performs whatever must happen on the details panel when the
  // selection is invoked.
  registerOnDetailsPanelSelectionChange(
      onDetailsPanelSelectionChange: (newSelection?: Selection) => void): void;
  // Register a custom button on the timeline
  registerCustomButton(button: CustomButtonArgs): void;

  registerOnTrackSelectionChange(
    onTrackSelectionChange:
      (trackIds: string[], trackGroupIds: string[]) => void): void;
}

export interface PluginInfo {
  // A unique string for your plugin. To ensure the name is unique you
  // may wish to use a URL with reversed components in the manner of
  // Java package names.
  pluginId: string;

  // This function is called when the plugin is loaded. Generally this
  // is called at most once shortly after the UI is loaded. However in
  // some situations it can be called multiple times - for example
  // when the user is toggling plugins on/off.
  activate: (ctx: PluginContext) => void;
}
