---
title: "Cancellation Tokens End to End: Request, DbContext and Worker"
slug: "cancellation-tokens-end-to-end"
excerpt: "Cancellation is opt-in at every layer. Threading the token from the request through EF Core to background workers is what makes shutdown and timeouts clean."
category: "Async & Concurrency"
tags: ["cancellation", "async", "robustness"]
date: "2026-04-27"
level: "Advanced"
author: "Riad Hossain"
---

A cancellation token is not a switch that stops work; it is a request that cooperating code poll or observe and then act on. Nothing happens unless every layer passes it along and checks it, and a single method that drops the token on the floor means a client disconnect keeps a database query running to completion. Threading the token from the request edge through the data layer into worker loops is what makes timeouts, disconnects, and shutdown behave predictably.

## The token travels with the request

ASP.NET Core exposes `HttpContext.RequestAborted`, which fires when the client disconnects or the server aborts the request. Minimal APIs and controllers can bind it as a parameter, and from there you pass it into every async call on the path.

```csharp
app.MapGet("/orders/{id:int}", async (
    int id,
    AppDbContext db,
    CancellationToken ct) =>
{
    var order = await db.Orders
        .AsNoTracking()
        .FirstOrDefaultAsync(o => o.Id == id, ct);

    return order is null ? Results.NotFound() : Results.Ok(order);
});
```

If the client hangs up mid-query, the token is cancelled, EF Core issues a cancellation against the database command, and the request unwinds instead of consuming a connection for work nobody will read.

### Combining a request token with a timeout

A per-operation budget is often different from the request lifetime, so link the two. `CreateLinkedTokenSource` produces a token that is cancelled when either input is, and `CancelAfter` adds a deadline that does not depend on the client.

```csharp
using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
cts.CancelAfter(TimeSpan.FromSeconds(5));

var page = await httpClient.GetFromJsonAsync<Page>(url, cts.Token);
```

The linked source must be disposed; forgetting to do so leaks a registration on the parent token and is exactly the kind of slow leak that only shows up in long-lived processes.

## Cancellation inside EF Core

Every asynchronous EF Core API accepts a token: `ToListAsync`, `FirstOrDefaultAsync`, `SaveChangesAsync`, `ExecuteUpdateAsync`, `BeginTransactionAsync`. Passing it is not optional if you care about disconnects. When the token is cancelled, the provider sends a cancellation to the server through its own channel rather than killing the connection, so the connection returns to the pool in a usable state.

```csharp
var updated = await context.Orders
    .Where(o => o.Status == OrderStatus.Stale)
    .ExecuteUpdateAsync(
        setters => setters.SetProperty(o => o.Status, OrderStatus.Archived),
        ct);
```

Bulk operations deserve care here. `ExecuteUpdateAsync` may affect many rows in one statement, and if the token cancels partway through a multi-statement batch there is no automatic rollback unless you wrapped the work in a transaction. For anything that must be all-or-nothing, open a transaction and let the cancellation abort it, so the partial work is rolled back with it.

### Workers observe the stopping token

A background worker gets a token that the host cancels during graceful shutdown. The loop should check it between units of work and pass it into every awaited call, so shutdown is bounded rather than waiting for a long batch to finish.

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    while (!stoppingToken.IsCancellationRequested)
    {
        await ProcessBatchAsync(stoppingToken);
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
    }
}
```

## Telling cancellation apart from failure

Cancellation is control flow, not an error, and treating it as one floods logs and alerts during every deploy.

- Catch `OperationCanceledException` only when the token is actually cancelled, and rethrow or return quietly rather than logging it at error level.
- Check `token.IsCancellationRequested` at loop boundaries with `ThrowIfCancellationRequested` rather than inspecting a flag manually.
- Do not swallow the exception with a broad catch that returns a default, because that hides a genuine shutdown request.
- For a critical commit that must complete even during shutdown, deliberately pass no token or a detached one, and document why that step is uncancellable.

The trade-off is that responsive cancellation requires cooperation at every layer and a decision at each one about what is safe to abandon. Cancel between units of work and at awaits, but finish commits and state transitions you have already begun, because a query that stops halfway is harmless while a half-written order is not.
