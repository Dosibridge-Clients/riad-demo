---
title: "Background Services with IHostedService and Worker Services"
slug: "background-services-hostedservice"
excerpt: "BackgroundService is a one-line worker, but its lifecycle, scope handling and shutdown semantics decide whether it restarts cleanly under a supervisor."
category: "Async & Concurrency"
tags: ["hosted-service", "workers", "lifecycle"]
date: "2026-04-03"
level: "Advanced"
author: "Riad Hossain"
---

Long-running work that must not block a request belongs in a hosted service. The generic host starts each registered implementation during startup, stops them in reverse order during shutdown, and ties their cancellation to the same token the rest of the application observes. Getting that lifecycle right is the difference between a worker that stops promptly on deploy and one that leaves half-finished batches behind.

## IHostedService versus BackgroundService

`IHostedService` is the base contract with `StartAsync` and `StopAsync`. `BackgroundService` implements it for you and hands you an `ExecuteAsync` that runs the loop; you override that one method and ignore the rest unless you need custom start or stop logic.

```csharp
public sealed class OutboxDispatcher : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await DispatchPendingAsync(stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
```

The base implementation is rarely worth overriding. `BackgroundService.StartAsync` calls `ExecuteAsync` and stores the returned task, and `StopAsync` cancels the token and awaits that task. If you override `StartAsync` and run your own work before calling base, you change when the host considers itself started, which is a common source of races where a request arrives before the worker is ready.

### The startup blocking trap

`ExecuteAsync` runs synchronously up to its first `await`. If you do a long synchronous operation or a blocking call before that point, the host cannot finish starting and no request is served until the worker yields. Await `Task.Yield` at the top of `ExecuteAsync` when the first statement is not already asynchronous.

## Scoped dependencies inside a singleton worker

A hosted service is registered as a singleton, so it cannot inject a scoped `DbContext` or a scoped repository directly. Inject `IServiceScopeFactory` and create a scope per unit of work.

```csharp
using IServiceScope scope = _scopeFactory.CreateScope();
var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
await DispatchOnceAsync(db, stoppingToken);
```

Resolve every scoped service inside the scope you create and let the scope dispose it. Reaching back into the root provider for something scoped throws at runtime when scope validation is enabled, which is exactly the guardrail you want turned on during development and left on in production.

Creating one scope for the lifetime of the worker is the captive-dependency bug in slow motion: the `DbContext` accumulates tracked entities, its connection stays open, and the change tracker grows without bound.

## Registration, ordering and graceful shutdown

`AddHostedService<T>` registers the worker; each `StartAsync` runs in registration order and each `StopAsync` runs in reverse. Shutdown is bounded by `HostOptions.ShutdownTimeout`, and if a worker ignores the stopping token the host abandons it when the timeout elapses.

- Pass `stoppingToken` into every awaited call, including `Task.Delay`, so shutdown interrupts sleeps.
- Finish the unit of work you already started; do not abandon a transaction mid-flight.
- Log a distinct line at loop entry and exit so restarts are visible in the logs.
- Prefer a short delay between iterations over a tight loop that spins the CPU when idle.

The trade-off is between responsiveness and completeness. Checking the token between items gives a fast, clean stop; working through a durability checkpoint gives completeness at the cost of a slower stop, and for anything that cannot be safely repeated you want the checkpoint.
