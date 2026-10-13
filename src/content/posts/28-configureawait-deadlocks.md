---
title: "ConfigureAwait, SynchronizationContext and Deadlocks"
slug: "configureawait-deadlocks"
excerpt: "Captured synchronization contexts cause the classic deadlock. What the continuation captures explains why ConfigureAwait(false) still matters in libraries."
category: "Async & Concurrency"
tags: ["async", "configureawait", "deadlock"]
date: "2026-05-03"
level: "Advanced"
author: "Riad Hossain"
---

The deadlock that eats an afternoon looks like a hang with no exception and no CPU use, and it almost always comes from blocking on an async call while a synchronization context is captured. The mechanism is entirely mechanical once you see it, and it explains both why the bug exists and why it vanished when the team upgraded to ASP.NET Core without anyone touching the code.

## What an await actually captures

When you await a task that is not yet complete, the awaiter registers a continuation through `OnCompleted`. That registration captures the current `SynchronizationContext` or `TaskScheduler`, and when the awaited operation finishes, the continuation is posted back to that captured context rather than run on whatever thread completed the operation. On a UI framework that context marshals to the single UI thread. On classic ASP.NET it marshalled back to the request thread. The whole point is that code after the await can touch thread-affine state safely.

```csharp
// In a UI or classic ASP.NET context, this hangs.
public string Get()
{
    return FetchAsync().GetAwaiter().GetResult();
}

private async Task<string> FetchAsync()
{
    await Task.Delay(100); // continuation wants the captured context
    return "done";
}
```

Trace it: the caller blocks the only thread the context can post to, the continuation is queued to that same blocked thread, the task never completes, and the block never returns. That is the deadlock. It is not a bug in the framework; it is a direct consequence of blocking a thread the continuation needs.

### ConfigureAwait(false) removes the capture

Passing false tells the awaiter not to capture the context, so the continuation runs on the thread pool instead of being posted back. The deadlock disappears because the continuation no longer needs the blocked thread, and there is a smaller, secondary win: posting back to a context is a scheduling hop, so avoiding it reduces overhead when the context is not needed.

```csharp
public async Task<Report> BuildAsync(CancellationToken ct)
{
    var data = await _repository.LoadAsync(ct).ConfigureAwait(false);
    var totals = await _pricer.CalculateAsync(data, ct).ConfigureAwait(false);
    return Compose(data, totals);
}
```

The important subtlety is that `ConfigureAwait(false)` governs only the await it is attached to. It does not affect awaits inside the methods you call, so a library that forgot to use it can still deadlock even if your code asks not to capture.

## Where it matters and where it does not

ASP.NET Core removed the per-request `SynchronizationContext`, so the classic deadlock cannot occur there; code after an await runs on a thread pool thread regardless, and `ConfigureAwait(false)` buys almost nothing for performance. The guidance that survives is about what happens when your code is hosted somewhere it does not control.

- Library code should use `ConfigureAwait(false)` on every await it does not need the context for, because the library does not know whether its caller is a UI app, a legacy host, or a console tool.
- Application code on ASP.NET Core can leave the default, since there is no context to capture and the noise is not worth it.
- Never block on async work with `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()` in a path that can be called from a synchronous API, because that is the exact move that creates the deadlock when a context exists.
- Use `Task.Run` to move genuinely CPU-bound work off the current thread, not to dodge a synchronization context, since offloading I/O to the thread pool is just paying for a hop you did not need.

## Continuations and async void

`async void` methods are dangerous in this space because they have no task to await, so their continuations capture the context with no way for the caller to observe completion or failure. Exceptions thrown after the first await are rethrown on the captured context, which in a UI app typically surfaces as an unhandled exception on the dispatcher. Restrict `async void` to event handlers and make it async-safe wrappers around an `async Task` implementation.

The trade-off is readability against host-proofing. Sprinkling `ConfigureAwait(false)` everywhere clutters a codebase that only ever runs on ASP.NET Core, while omitting it in a shipped library breaks a consumer you will never see. Put the calls in the libraries and the shared infrastructure, leave application endpoints clean, and treat any blocking call in an async call chain as a defect to be removed rather than wrapped.
