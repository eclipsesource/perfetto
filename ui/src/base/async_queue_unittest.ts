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

import { AsyncQueue } from './async_queue';
import { defer } from './deferred';

test('no concurrent callbacks', async () => {
    const queue = new AsyncQueue();

    const barrier = defer<void>();
    const mock1 = jest.fn();
    queue.schedule(async () => {
        await barrier;
        mock1();
    });
    expect(mock1).not.toHaveBeenCalled();

    const mock2 = jest.fn();
    queue.schedule(async () => mock2());
    expect(mock2).not.toHaveBeenCalled();

    barrier.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mock1).toHaveBeenCalled();
    expect(mock2).toHaveBeenCalled();
});

test('queueing', async () => {
    const queue = new AsyncQueue();

    const mock1 = jest.fn();
    queue.schedule(async () => mock1());

    const mock2 = jest.fn();
    await queue.schedule(async () => mock2());

    expect(mock1).toHaveBeenCalled();
    expect(mock2).toHaveBeenCalled();
});

test('multiple queuing executes all tasks', async () => {
    const queue = new AsyncQueue();

    const mock1 = jest.fn();
    queue.schedule(async () => mock1());

    const mock2 = jest.fn();
    queue.schedule(async () => mock2());

    const mock3 = jest.fn();
    await queue.schedule(async () => mock3());

    expect(mock1).toHaveBeenCalled();
    expect(mock2).toHaveBeenCalled();
    expect(mock3).toHaveBeenCalled();
});

test('tasks execute in order', async () => {
    const queue = new AsyncQueue();
    const order: number[] = [];

    queue.schedule(async () => order.push(1));
    queue.schedule(async () => order.push(2));
    queue.schedule(async () => order.push(3));
    await queue.schedule(async () => order.push(4));

    expect(order).toEqual([1, 2, 3, 4]);
});

test('returns value from task', async () => {
    const queue = new AsyncQueue();

    const result = await queue.schedule(async () => 42);

    expect(result).toBe(42);
});

test('returns different values from different tasks', async () => {
    const queue = new AsyncQueue();

    const promise1 = queue.schedule(async () => 'first');
    const promise2 = queue.schedule(async () => 'second');
    const promise3 = queue.schedule(async () => 'third');

    expect(await promise1).toBe('first');
    expect(await promise2).toBe('second');
    expect(await promise3).toBe('third');
});

test('error in callback bubbles up to caller', async () => {
    const queue = new AsyncQueue();
    const failingCallback = async () => {
        throw Error('test error');
    };

    await expect(queue.schedule(failingCallback)).rejects.toThrow('test error');
});

test('chain continues even when one callback fails', async () => {
    const queue = new AsyncQueue();

    const failingCallback = async () => {
        throw Error();
    };
    queue.schedule(failingCallback).catch(() => { });

    const mock = jest.fn();
    await queue.schedule(async () => mock());

    expect(mock).toHaveBeenCalled();
});

test('error in middle task does not affect other tasks', async () => {
    const queue = new AsyncQueue();

    const mock1 = jest.fn();
    const promise1 = queue.schedule(async () => mock1());

    const failingCallback = async () => {
        throw Error('middle error');
    };
    const promise2 = queue.schedule(failingCallback);

    const mock3 = jest.fn();
    const promise3 = queue.schedule(async () => mock3());

    await promise1;
    await expect(promise2).rejects.toThrow('middle error');
    await promise3;

    expect(mock1).toHaveBeenCalled();
    expect(mock3).toHaveBeenCalled();
});

test('handles async operations correctly', async () => {
    const queue = new AsyncQueue();
    const order: number[] = [];

    const barrier1 = defer<void>();
    const barrier2 = defer<void>();

    queue.schedule(async () => {
        await barrier1;
        order.push(1);
    });

    queue.schedule(async () => {
        await barrier2;
        order.push(2);
    });

    const promise3 = queue.schedule(async () => {
        order.push(3);
    });

    expect(order).toEqual([]);

    barrier1.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([1]);

    barrier2.resolve();
    await promise3;
    expect(order).toEqual([1, 2, 3]);
});

test('can schedule new tasks from within executing task', async () => {
    const queue = new AsyncQueue();
    const order: number[] = [];

    await queue.schedule(async () => {
        order.push(1);
        queue.schedule(async () => order.push(3));
        order.push(2);
    });

    await queue.schedule(async () => order.push(4));

    expect(order).toEqual([1, 2, 3, 4]);
});

test('multiple concurrent schedule calls wait for each other', async () => {
    const queue = new AsyncQueue();
    const barrier = defer<void>();
    const results: string[] = [];

    queue.schedule(async () => {
        await barrier;
        results.push('first');
    });

    const promises = [
        queue.schedule(async () => {
            results.push('second');
            return 'second';
        }),
        queue.schedule(async () => {
            results.push('third');
            return 'third';
        }),
        queue.schedule(async () => {
            results.push('fourth');
            return 'fourth';
        }),
    ];

    expect(results).toEqual([]);

    barrier.resolve();
    const values = await Promise.all(promises);

    expect(results).toEqual(['first', 'second', 'third', 'fourth']);
    expect(values).toEqual(['second', 'third', 'fourth']);
});
