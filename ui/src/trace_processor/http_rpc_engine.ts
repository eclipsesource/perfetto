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

import protos from '../protos';
import {fetchWithTimeout} from '../base/http_utils';
import {assertExists, reportError} from '../base/logging';
import {EngineBase} from '../trace_processor/engine';

const RPC_CONNECT_TIMEOUT_MS = 2000;
const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

export interface HttpRpcState {
  connected: boolean;
  status?: protos.StatusResult;
  failure?: string;
}

export class HttpRpcEngine extends EngineBase {
  readonly mode = 'HTTP_RPC';
  readonly id: string;
  private requestQueue = new Array<Uint8Array>();
  private websocket?: WebSocket;
  private connected = false;
  private disposed = false;
  private queue: Blob[] = [];
  private isProcessingQueue = false;
  private retryDelayMs = INITIAL_RETRY_DELAY_MS;
  private retryTimeoutId?: ReturnType<typeof setTimeout>;

  // Can be changed by frontend/index.ts when passing ?rpc_port=1234 .
  static defaultRpcPort = '9001';

  constructor(
    id: string,
    private port: string,
  ) {
    super();
    this.id = id;
  }

  rpcSendRequestBytes(data: Uint8Array): void {
    if (this.disposed) return;
    this.websocket ??= this.initWebSocket();

    if (this.connected) {
      this.websocket.send(data);
    } else {
      this.requestQueue.push(data); // onWebsocketConnected() will flush this.
    }
  }

  private initWebSocket(): WebSocket {
    const wsUrl = `ws://${HttpRpcEngine.getHostAndPort(this.port)}/websocket`;
    this.websocket = new WebSocket(wsUrl);
    this.websocket.onopen = () => this.onWebsocketConnected();
    this.websocket.onmessage = (e) => this.onWebsocketMessage(e);
    this.websocket.onclose = (e) => this.onWebsocketClosed(e);
    this.websocket.onerror = (e) => this.onWebsocketError(e);
    return this.websocket;
  }

  private onWebsocketError(e: Event): void {
    if (this.disposed) return;
    const readyState = (e.target as WebSocket)?.readyState;
    console.warn(`WebSocket error rs=${readyState}, will retry with backoff`);
    // The close event will fire after this, which will trigger the retry logic
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;

    console.debug(
      `Scheduling WebSocket reconnection in ${this.retryDelayMs}ms`,
    );

    this.retryTimeoutId = setTimeout(() => {
      if (this.disposed) return;
      console.debug('Attempting WebSocket reconnection...');
      this.initWebSocket();
    }, this.retryDelayMs);

    // Exponential backoff with cap
    this.retryDelayMs = Math.min(
      this.retryDelayMs * BACKOFF_MULTIPLIER,
      MAX_RETRY_DELAY_MS,
    );
  }

  private onWebsocketConnected() {
    // Reset retry delay on successful connection
    this.retryDelayMs = INITIAL_RETRY_DELAY_MS;

    for (;;) {
      const queuedMsg = this.requestQueue.shift();
      if (queuedMsg === undefined) break;
      assertExists(this.websocket).send(queuedMsg);
    }
    console.debug('WebSocket (re)connected on port', this.port);
    this.connected = true;
  }

  private onWebsocketClosed(e: CloseEvent) {
    if (this.disposed) return;

    // Always attempt to reconnect with backoff, regardless of close code
    console.debug(
      `WebSocket closed (code=${e.code}, reason=${e.reason || 'none'}, wasConnected=${this.connected}), scheduling reconnect`,
    );

    this.websocket = undefined;
    this.connected = false;
    this.scheduleReconnect();
  }

  private onWebsocketMessage(e: MessageEvent) {
    const blob = assertExists(e.data as Blob);
    this.queue.push(blob);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    while (this.queue.length > 0) {
      try {
        const blob = assertExists(this.queue.shift());
        const buf = await blob.arrayBuffer();
        super.onRpcResponseBytes(new Uint8Array(buf));
      } catch (e) {
        reportError(e);
      }
    }
    this.isProcessingQueue = false;
  }

  static async checkConnection(port: string): Promise<HttpRpcState> {
    const RPC_URL = `http://${HttpRpcEngine.getHostAndPort(port)}/`;
    const httpRpcState: HttpRpcState = {connected: false};
    console.info(
      `It's safe to ignore the ERR_CONNECTION_REFUSED on ${RPC_URL} below. ` +
        `That might happen while probing the external native accelerator. The ` +
        `error is non-fatal and unlikely to be the culprit for any UI bug.`,
    );
    try {
      const resp = await fetchWithTimeout(
        RPC_URL + 'status',
        {method: 'post', cache: 'no-cache'},
        RPC_CONNECT_TIMEOUT_MS,
      );
      if (resp.status !== 200) {
        httpRpcState.failure = `${resp.status} - ${resp.statusText}`;
      } else {
        const buf = new Uint8Array(await resp.arrayBuffer());
        // Decode the response buffer first. If decoding is successful, update the connection state.
        // This ensures that the connection state is only set to true if the data is correctly parsed.
        httpRpcState.status = protos.StatusResult.decode(buf);
        httpRpcState.connected = true;
      }
    } catch (err) {
      httpRpcState.failure = `${err}`;
    }
    return httpRpcState;
  }

  static getHostAndPort(port = HttpRpcEngine.defaultRpcPort) {
    return `127.0.0.1:${port}`;
  }

  [Symbol.dispose]() {
    this.disposed = true;
    this.connected = false;

    // Clear any pending retry timeout
    if (this.retryTimeoutId !== undefined) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = undefined;
    }

    const websocket = this.websocket;
    this.websocket = undefined;
    websocket?.close();
  }
}
