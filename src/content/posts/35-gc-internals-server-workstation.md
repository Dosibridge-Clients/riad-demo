---
title: "Garbage Collection Internals: Server vs Workstation GC"
slug: "gc-internals-server-workstation"
excerpt: "Server GC gives every core its own heap and collection thread, which raises throughput and memory use. The right setting depends on the process, not on habit."
category: "Performance & Diagnostics"
tags: ["gc", "memory", "tuning"]
date: "2026-03-22"
level: "Advanced"
author: "Riad Hossain"
---

The .NET garbage collector is generational, concurrent and mostly stop-the-world, and the single biggest configuration lever is whether it runs in workstation or server mode. That choice changes the heap layout, the number of collection threads and the memory footprint, and it is set by the host rather than by your code. Picking the wrong mode for the process shape is a common source of latency spikes and surprising resident memory.

## Generations and the heap

Objects start in generation 0, survive a collection into generation 1, and stabilize in generation 2. Small objects live on the small object heap; objects at or above 85,000 bytes go to the large object heap, which is collected only with generation 2 and is not compacted by default. Pinned objects live on the pinned object heap so that pinning does not fragment the rest. The budget for generation 0 sets how often it is collected, and that budget grows while the survivor rate stays low.

```xml
<PropertyGroup>
  <ServerGarbageCollection>true</ServerGarbageCollection>
  <ConcurrentGarbageCollection>true</ConcurrentGarbageCollection>
  <TieredCompilation>true</TieredCompilation>
</PropertyGroup>
```

## Workstation versus server GC

Workstation GC runs a single heap with a single collection thread and keeps the footprint small; it suits desktop apps and small containers. Server GC creates one heap and one dedicated collection thread per logical core, which parallelizes collection and raises throughput at the cost of much higher memory use.

### The knobs that matter

- `System.GC.Server`: switches to server mode, the usual default for ASP.NET Core on a server runtime.
- `System.GC.Concurrent`: enables background collection so long generation 2 pauses shrink.
- `System.GC.RetainVM`: keeps memory after it is freed, trading resident size for lower re-allocation cost.
- `DOTNET_gcServer` and related variables set the same values through the environment in a container.

## Latency modes and no-GC regions

For a short, latency-critical section you can ask the collector to behave differently. `GCSettings.LatencyMode` selects a policy, and `GC.TryStartNoGCRegion` asks for a region in which the collector reserves budget up front and then does not collect.

```csharp
if (GC.TryStartNoGCRegion(64 * 1024 * 1024))
{
    try
    {
        RenderFrame();
    }
    finally
    {
        GC.EndNoGCRegion();
    }
}
```

If allocations exceed the reserved budget the region ends early and a collection happens anyway, so size the reservation above the real working set or you defeat the purpose.

## Allocation patterns that decide the outcome

The collector is a symptom of your allocation rate; the fix is usually fewer, shorter-lived objects.

- Cache large arrays in an `ArrayPool<byte>` instead of allocating per request.
- Avoid closures and LINQ chains in per-request hot paths, because each capture allocates.
- Prefer `struct` for small, short-lived values that do not escape.
- Watch `% Time in GC` and the allocation rate before tuning any setting.

The trade-off is that server GC buys throughput with memory, and in a small container the per-core heaps can be large enough to hit the container limit instead of helping. Match the GC mode and the memory limit to each other, and measure heap size under real load rather than trusting a default.
