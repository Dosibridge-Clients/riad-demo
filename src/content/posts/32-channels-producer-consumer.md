---
title: "Channels: Bounded Producer/Consumer Pipelines in .NET"
slug: "channels-producer-consumer"
excerpt: "System.Threading.Channels gives in-process producer/consumer queues with real backpressure, but only if you bound them and complete the writer."
category: "Async & Concurrency"
tags: ["channels", "backpressure", "workers"]
date: "2026-04-09"
level: "Advanced"
author: "Riad Hossain"
---

`System.Threading.Channels` is the in-process queue you reach for when a producer runs faster than a consumer and you do not want to lose work or grow an unbounded list. It is async-first, it supports multiple readers and writers, and it gives you one backpressure knob. The failure mode is almost always the same: the channel is created unbounded, the consumer lags, and the process dies holding a queue in memory.

## Creating a channel and choosing a bound

`Channel.CreateBounded` takes a capacity and an options object; `Channel.CreateUnbounded` takes neither and will happily accept work faster than any consumer can drain it.

```csharp
var channel = Channel.CreateBounded<WorkItem>(new BoundedChannelOptions(1024)
{
    FullMode = BoundedChannelFullMode.Wait,
    SingleReader = true,
    SingleWriter = false,
});
```

`SingleReader` and `SingleWriter` are not cosmetic. When you declare a single reader, the implementation can skip the coordination needed to wake several consumers at once, so set them accurately and relax them only when you genuinely have more than one.

### What FullMode decides

`BoundedChannelFullMode.Wait` makes `WriteAsync` await capacity, which is real backpressure and the correct default for work you cannot drop. `DropOldest`, `DropNewest` and `DropWrite` instead discard items to keep the producer moving, which suits telemetry or metrics where the newest sample matters more than the oldest.

## Producer and consumer loops

The writer side calls `WriteAsync` and finally `Complete`, which signals that no more items are coming. The reader consumes with `ReadAllAsync`, an async stream that ends when the writer completes and the channel drains.

```csharp
// producer
await channel.Writer.WriteAsync(item, ct);
channel.Writer.Complete();

// consumer
await foreach (var item in channel.Reader.ReadAllAsync(ct))
{
    await HandleAsync(item, ct);
}
```

The `Complete` call is not optional. A consumer blocked on `ReadAllAsync` waits forever if the writer never completes, and a graceful shutdown that awaits that consumer will hang.

## Scaling the consumer

For parallel consumption, set `SingleReader = false`, start several consumer tasks, and await them all. Bound the count to the resource you depend on rather than to a round number.

- A `DbContext` is not thread-safe, so create a scope per item inside the handler.
- Await the consumer tasks with `Task.WhenAll` so shutdown is deterministic.
- Catch and log per-item failures so one bad item does not stop the reader loop.
- Do not start a new consumer per item; that is an unbounded thread count with extra steps.

A useful pattern for a fire-and-forget producer is `TryWrite`, which returns `false` immediately instead of awaiting capacity; pairing it with `Wait` mode and a bounded channel drops load at the edge rather than letting it queue. For a producer that must not lose work, await `WriteAsync`, which is where the backpressure actually applies.

## Failure modes worth designing against

An unbounded channel converts a slow consumer into an eventual `OutOfMemoryException`. A writer that throws before calling `Complete` leaves readers stuck forever. A producer that fires `WriteAsync` without awaiting it defeats the bound and rebuilds the unbounded queue by hand.

The trade-off is that backpressure moves the problem upstream, where it is visible. A bounded channel makes the producer wait, which may mean an HTTP request slows down or a poller falls behind, and that is almost always better than a queue that grows until the host restarts.
