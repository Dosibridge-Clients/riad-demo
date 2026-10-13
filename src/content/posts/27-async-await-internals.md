---
title: "async and await Internals: State Machines, Allocation and ValueTask"
slug: "async-await-internals"
excerpt: "Every async method compiles to a state machine. Knowing when that machine allocates, and when ValueTask avoids it, changes how you design hot paths."
category: "Async & Concurrency"
tags: ["async", "valuetask", "internals"]
date: "2026-05-09"
level: "Advanced"
author: "Riad"
---

Contrary to the recurring myth, `async` does not start a thread, and awaiting does not block one. The compiler rewrites an async method into a state machine, and the runtime decides at each suspension point whether that machine stays on the stack or moves to the heap. Understanding that decision is the difference between guessing at performance and knowing why a hot path allocates.

## The compiler-generated state machine

When you mark a method `async`, the compiler generates a struct that implements `IAsyncStateMachine` with a `MoveNext` method and a `SetStateMachine` method, plus a builder chosen from the return type. Before the first incomplete await the machine lives on the stack, and a call that completes synchronously never allocates a thing. The moment an awaiter reports it is not yet complete, the builder calls `SetStateMachine` to move the machine to the heap, stores the continuation as `MoveNext`, and returns an incomplete task to the caller.

```csharp
public async Task<int> ReadLengthAsync(Stream stream, byte[] buffer, CancellationToken ct)
{
    var read = await stream.ReadAsync(buffer, ct).ConfigureAwait(false);
    return read;
}
```

The await rewrites the method into roughly: evaluate the task, ask its awaiter whether it is complete, and if not, store the current state and the local variables, register the continuation, and return. Picking up again re-enters `MoveNext`, which jumps to the stored state and resumes. The locals become fields on the struct, which is why an async method cannot capture a `ref` local across an await.

### Synchronous completion is the fast path

Most awaits complete synchronously in real applications: a cached value, a buffered socket read, a dictionary hit. On that path the state machine stays a struct on the stack, no task is allocated for the continuation, and the cost approaches that of a synchronous call. The allocation only happens when the operation actually suspends, which is why a method that awaits on a completed task is dramatically cheaper than one that awaits on network I/O.

## Task, Task of T, and ValueTask

`AsyncTaskMethodBuilder` produces a `Task`, which is a reference type and therefore allocates on every suspension. `AsyncValueTaskMethodBuilder<T>` produces a `ValueTask<T>`, which is a struct that wraps either a result, a `Task<T>`, or an `IValueTaskSource<T>`. When the operation completes synchronously, the `ValueTask<T>` carries the result inline and allocates nothing at all.

```csharp
public ValueTask<int> TryReadCachedAsync(int key, CancellationToken ct)
{
    if (_cache.TryGetValue(key, out var value))
        return new ValueTask<int>(value);

    return new ValueTask<int>(LoadFromStoreAsync(key, ct));
}
```

The value is not free. A `ValueTask` may be awaited only once, must not be stored in a field and awaited later, and must never be awaited concurrently or reused. It is a contract meant to be consumed exactly once by the immediate caller, which is why library authors rarely expose it except on measured hot paths.

### The IValueTaskSource route

The allocation-free path for genuinely asynchronous operations is `IValueTaskSource<T>`, a pooled object that backs many `ValueTask<T>` instances over its lifetime. The classic implementation is `ManualResetValueTaskSourceCore<T>`, which you embed and delegate to.

```csharp
public sealed class SignalWaiter : IValueTaskSource<int>
{
    private ManualResetValueTaskSourceCore<int> _core;

    public ValueTask<int> WaitAsync() => new(this, _core.Version);
    public int GetResult(short token) => _core.GetResult(token);
    public ValueTaskSourceStatus GetStatus(short token) => _core.GetStatus(token);

    public void OnCompleted(Action<object?> continuation, object? state,
        short token, ValueTaskSourceOnCompletedFlags flags) =>
        _core.OnCompleted(continuation, state, token, flags);
}
```

Return the waiter to a pool after the caller consumes the result and the version number guarantees a stale token cannot read a recycled result.

## Where the allocations actually come from

- Every suspension allocates one `Task` unless the method returns `ValueTask` and completes inline.
- Iterating with `await` inside a `for` loop allocates once per iteration that suspends, so a loop over a thousand network calls is a thousand task allocations.
- `async void` allocates and cannot be awaited, so exceptions escape to the thread pool and crash the process; use it only for event handlers.
- Blocking with `.Result` or `.Wait()` on an async call burns a thread and can deadlock, and it does not make the operation synchronous, it just hides the suspension from your code.

The trade-off is complexity traded for allocation. Most code should return `Task` and await it normally, and only measured hot paths should reach for `ValueTask` or a custom source. The mistake is optimising the wrong layer: a single database round trip dwarfs a thousand task allocations, so profile before you rewrite a clean `Task` API into a struct you now have to police for misuse.
