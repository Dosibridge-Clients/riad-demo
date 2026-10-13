---
title: "Parallelism with Parallel.ForEachAsync and TPL Dataflow"
slug: "parallel-foreachasync-tpl-dataflow"
excerpt: "Parallel.ForEachAsync bounds concurrency without thread starvation, and TPL Dataflow adds backpressure. Both fail the same way when a DbContext is shared."
category: "Async & Concurrency"
tags: ["parallelism", "dataflow", "throughput"]
date: "2026-04-21"
level: "Advanced"
author: "Riad"
---

When a job needs to process ten thousand items and each item waits on network or database I/O, sequential work wastes the machine and unbounded parallelism wastes the downstream service. The problem is not how to start many tasks; it is how to start exactly enough of them to saturate the bottleneck without overrunning a connection pool or a rate limit. `Parallel.ForEachAsync` and TPL Dataflow both express that bound, and both punish the one mistake of sharing a database context across iterations.

## Bounded parallelism with Parallel.ForEachAsync

`Parallel.ForEachAsync` is asynchronous-aware, so a bounded degree of parallelism does not block thread pool threads the way the synchronous `Parallel.ForEach` would. Each iteration receives its own cancellation token tied to the operation, and the degree of parallelism caps how many iterations run at once.

```csharp
await Parallel.ForEachAsync(
    ids,
    new ParallelOptions
    {
        MaxDegreeOfParallelism = Environment.ProcessorCount * 2,
        CancellationToken = ct,
    },
    async (id, token) =>
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await EnrichAsync(db, id, token);
    });
```

The scope inside the iteration is the important part. A `DbContext` is not thread-safe, so borrowing one from a shared scope and touching it from two iterations corrupts the change tracker and throws an opaque concurrency exception that looks like a database error and is not one.

### Sizing the degree of parallelism

The right number depends on what the iterations wait on. For I/O-bound work the ceiling is the downstream resource, usually the connection pool or a rate limit, not the CPU. For CPU-bound work it is the core count, and going beyond it just adds context switching.

- I/O-bound: pick a degree close to the size of the resource you depend on, such as the connection pool maximum.
- CPU-bound: use `Environment.ProcessorCount` and stop there.
- Mixed: measure, because the fastest setting is a property of the downstream service, not of your code.
- Never leave it unbounded on a large collection, because that is how you convert a slow dependency into an outage for it.

## Pipelines with TPL Dataflow

For multi-stage work, Dataflow composes blocks into a pipeline, and `BoundedCapacity` gives you backpressure: a full block refuses new items, which propagates upstream and stops the producer from running ahead of the consumer. Without a bound, a fast producer and a slow consumer simply accumulate items in memory until the process dies.

```csharp
var options = new ExecutionDataflowBlockOptions
{
    MaxDegreeOfParallelism = 8,
    BoundedCapacity = 256,
};

var enrich = new TransformBlock<Order, EnrichedOrder>(async order =>
{
    await using var scope = scopeFactory.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    return await Transformer.RunAsync(db, order);
}, options);

var write = new ActionBlock<EnrichedOrder>(async item =>
{
    await writer.WriteAsync(item);
}, options);

enrich.LinkTo(write, new DataflowLinkOptions { PropagateCompletion = true });
```

### Completion and backpressure

`PropagateCompletion` forwards completion from one block to the next, so awaiting the terminal block's completion tells you the whole pipeline finished. Feeding the first block must respect backpressure too, so send with `SendAsync` and await it rather than posting without a bound.

- `BoundedCapacity` is the backpressure valve; leave it unbounded and you have a memory leak shaped like a queue.
- `MaxDegreeOfParallelism` on each block sets that stage's concurrency independently, so a slow stage does not have to slow a fast one.
- Order is not preserved across parallel stages, so sort after the pipeline if the consumer needs a stable sequence.

## The shared-context trap

Both APIs fail identically when a `DbContext` is shared across parallel bodies. The context tracks entities in a dictionary keyed by identity, and concurrent access to that dictionary is undefined, so you get intermittent exceptions, duplicated writes, or tracked entities from one iteration accidentally saved by another. Create a scope per iteration, or use an `IDbContextPool` / pooled factory to hand each iteration its own short-lived context, and never let a single context span the whole job.

The trade-off is that parallelism converts a clear, sequential bug into a load-dependent one. Concurrency hides in queues, so instrument in-flight work and downstream latency, tune one bound at a time, and resist raising a limit to make a symptom disappear; if the database is the bottleneck, more parallel callers to it will only make the queue longer and the timeouts more frequent.
