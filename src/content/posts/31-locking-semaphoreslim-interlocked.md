---
title: "Locking in .NET: lock, SemaphoreSlim and Interlocked"
slug: "locking-semaphoreslim-interlocked"
excerpt: "Picking between lock, SemaphoreSlim and Interlocked is really a choice between blocking a thread, suspending a task, or removing contention entirely."
category: "Async & Concurrency"
tags: ["locking", "concurrency", "semaphoreslim"]
date: "2026-04-15"
level: "Advanced"
author: "Riad"
---

Every synchronization primitive in the BCL answers a slightly different question. `lock` serializes access to a region of code by blocking a thread. `SemaphoreSlim` serializes access by suspending a task without parking a thread. `Interlocked` avoids the protected region altogether by making a single memory operation atomic. Choosing the wrong one produces code that compiles, runs, and only then surprises you under load with thread-pool starvation or a race that appears on a machine with more cores.

## What `lock` does at runtime

The `lock` keyword compiles to `Monitor.Enter` and `Monitor.Exit` wrapped in a `try`/`finally`. `Monitor` locks are reentrant, so the same thread can acquire the lock again without deadlocking itself, and they are thread-affine, so the thread that enters is the only one that may exit. The runtime keeps the lock state in the object header, so an uncontended acquire is a compare-and-swap and a kernel transition happens only under contention.

```csharp
private readonly object _gate = new();
private int _count;

public void Increment()
{
    lock (_gate)
    {
        _count = _count + 1;
        Publish(_count);
    }
}
```

The hard limitation is that you cannot `await` inside a `lock` body; the compiler rejects it with CS1996, because the continuation may resume on a different thread and `Monitor.Exit` would then run on a thread that never acquired the lock.

### The thread it blocks is a real thread

When a `lock` is contended, the runtime parks the waiting thread. That is fine on a thread-pool thread doing short CPU work, but if the protected region awaits I/O, the thread stays blocked for the whole I/O duration. Under load this exhausts the pool and produces the familiar pattern where latency climbs, the pool injects threads slowly, and throughput collapses while the CPU sits idle.

## SemaphoreSlim for async serialization

`SemaphoreSlim` with a single permit is the async-friendly mutual exclusion primitive. `WaitAsync` returns a task that completes when a permit is available, so the caller yields instead of parking a thread. It is not reentrant, it must be released in a `finally`, and it should be disposed when its lifetime ends.

```csharp
private readonly SemaphoreSlim _gate = new(1, 1);

public async Task RefreshAsync(CancellationToken ct)
{
    await _gate.WaitAsync(ct);
    try
    {
        await ReloadFromSourceAsync(ct);
    }
    finally
    {
        _gate.Release();
    }
}
```

### Bounding concurrency rather than excluding it

The same type also expresses "at most N at a time". Constructing it with `new SemaphoreSlim(8)` admits eight concurrent holders, which is how you throttle outbound calls to a dependency you do not own.

- `lock`: short, synchronous, CPU-bound regions only.
- `SemaphoreSlim(1, 1)`: any region that awaits.
- `SemaphoreSlim(n)`: bounded concurrency against a shared resource.
- `Interlocked`: a single field update with no region at all.

## Interlocked when there is no region to protect

`Interlocked.Increment`, `Decrement`, `Add`, `Exchange` and `CompareExchange` are lock-free and atomic on the field they touch. They are the right tool for counters, reference counts and compare-and-swap state transitions, and they never block.

```csharp
private int _inflight;
private long _totalBytes;

public void Enter() => Interlocked.Increment(ref _inflight);
public void Exit() => Interlocked.Decrement(ref _inflight);
public void Record(long bytes) => Interlocked.Add(ref _totalBytes, bytes);
```

The trade-off is that each `Interlocked` call protects exactly one memory location. As soon as an invariant spans two fields you need a lock or a compare-and-swap retry loop that spins until `CompareExchange` reports success. Reach for the cheapest primitive that actually guarantees your invariant, and instrument contention, because a lock that looks free in a benchmark is often the thing serializing every worker at three in the afternoon.
