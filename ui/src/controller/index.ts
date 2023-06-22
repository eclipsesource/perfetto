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

import '../gen/all_tracks';
import '../common/recordingV2/target_factories';

import {assertExists, assertTrue} from '../base/logging';

import {AppController} from './app_controller';
import {ControllerAny} from './controller';

let rootControllerMap = new Map<string, ControllerAny>();
let runningControllersMap = new Map<string, boolean>();

export function initController(extensionPort: MessagePort, globalsContext = '') {
  assertTrue(!rootControllerMap.has(globalsContext));
  const rootController = new AppController(extensionPort, globalsContext);
  rootControllerMap.set(globalsContext, rootController);
  runningControllersMap.set(globalsContext, false);
}

export function runControllers(globalsContext: string) {
  const runningControllers = runningControllersMap.get(globalsContext)
  if (runningControllers === undefined) throw new Error('Unknown controller');
  if (runningControllers) throw new Error('Re-entrant call detected');

  // Run controllers locally until all state machines reach quiescence.
  let runAgain = true;
  for (let iter = 0; runAgain; iter++) {
    if (iter > 100) throw new Error('Controllers are stuck in a livelock');
    runningControllersMap.set(globalsContext, true);
    try {
      runAgain = assertExists(rootControllerMap.get(globalsContext)).invoke();
    } finally {
      runningControllersMap.set(globalsContext, false);
    }
  }
}
