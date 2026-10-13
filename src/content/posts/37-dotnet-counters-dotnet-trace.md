---
title: "Diagnosing Production with dotnet-counters and dotnet-trace"
slug: "dotnet-counters-dotnet-trace"
excerpt: "dotnet-counters shows you the live signal, dotnet-trace records the CPU and event detail behind it. Together they diagnose a process without a restart."
category: "Performance & Diagnostics"
tags: ["diagnostics", "tracing", "production"]
date: "2026-03-10"
level: "Advanced"
author: "Riad Hossain"
---

When a service misbehaves in production you rarely get to attach a profiler or restart it under a debugger. The `dotnet-counters` and `dotnet-trace` global tools attach to a running process, read its EventPipe stream, and let you answer what it is doing right now and what it was doing during that spike, without changing the deployment. Knowing which signal to read first is most of the job.

## Counters for the live picture

`dotnet-counters` subscribes to the runtime's EventCounters and prints them at a sampling interval. It starts with a small default set; name the providers you want so you get HTTP request rates and GC statistics together.

Find the process first with `dotnet-counters ps`, which lists managed processes with their identifiers; guessing an id from shell output wastes a round trip and risks attaching to the wrong host. The tool reads the same EventPipe stream the runtime exposes on Linux, so it works inside a container as long as you can run a binary against that pid.

```bash
dotnet-counters monitor --process-id 4242 \
  --counters System.Runtime,Microsoft.AspNetCore.Hosting
```

### The counters that diagnose a symptom

- `cpu-usage` and `working-set` separate a compute problem from a memory problem.
- `gc-heap-size` and `time-in-gc` reveal whether pauses or the collector dominate latency.
- `threadpool-queue-length` and `threadpool-thread-count` expose thread starvation.
- `requests-per-second` and `current-requests` from the hosting provider show the load.
- An `exception-count` climbing without matching error logs points at a swallowed exception.

## Recording a trace

Counters tell you that something spiked; a trace tells you where. `dotnet-trace` captures a time window of the EventPipe stream with a sampling profiler and the runtime events, then writes a `.nettrace` file you convert for a viewer.

```bash
dotnet-trace collect --process-id 4242 \
  --providers Microsoft-DotNETCore-SampleProfiler,Microsoft-Windows-DotNETRuntime \
  --duration 00:00:30
```

### Converting and reading the trace

`dotnet-trace convert --format Speedscope` produces a file you open in a flame graph viewer, where the widest frames are the methods spending the most CPU. `dotnet-trace report <file> topN` prints the hottest methods without a viewer, which is often enough to spot an accidental quadratic loop or a serialization hot path.

## What to look for once you have data

Start from the symptom and work backward. Rising latency with flat CPU usually means blocking or queueing rather than slow computation. Rising `time-in-gc` with a growing heap points at an allocation or retention bug. A `threadpool-queue-length` that is never zero means the pool itself is the bottleneck.

Correlate the counters with the trace window. If `cpu-usage` saturates at the moment `requests-per-second` drops, you are looking at a compute-bound regression; if CPU stays flat and the queue grows, the bottleneck is downstream and the work is waiting rather than calculating.

## Doing this safely in production

- Collect to a file on a mounted volume, never stream a full trace to a terminal.
- Keep collection windows short; sampling is cheap but a large trace file is not.
- Prefer the sample profiler for CPU questions and add runtime providers only when needed.
- Delete trace files after analysis; they can contain request data.

The trade-off is overhead against resolution. Counters are nearly free and safe to leave running; a full trace with every provider enabled costs CPU and disk, so collect the narrowest window that still contains the event you are chasing.
