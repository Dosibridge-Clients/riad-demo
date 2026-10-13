---
title: "Distributed Tracing with OpenTelemetry in .NET"
slug: "opentelemetry-distributed-tracing"
excerpt: "OpenTelemetry connects one request across HTTP hops and database calls by propagating a trace context. Wiring it once beats chasing timing with log statements."
category: "Performance & Diagnostics"
tags: ["opentelemetry", "tracing", "observability"]
date: "2026-03-04"
level: "Advanced"
author: "Riad Hossain"
---

A request that crosses three services and two databases cannot be understood from logs on a single host. Distributed tracing follows one request as a tree of spans, each span tagged with the timing and attributes of one unit of work, and it works because every hop carries the same trace identifier forward. OpenTelemetry is the vendor-neutral way to produce and export that data from .NET.

## The pipeline: source, activity, exporter

An `ActivitySource` creates `Activity` objects, which are the spans. Instrumentation libraries for ASP.NET Core and `HttpClient` create them automatically; your own code creates them by hand where the automatic coverage stops. An exporter ships finished spans to a backend over OTLP, and a resource describes the process that produced them.

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api"))
    .WithTracing(tracing => tracing
        .AddSource("Orders.Pipeline")
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter(o => o.Endpoint = new Uri("http://otel-collector:4317")));
```

The instrumentation names matter. `AddAspNetCoreInstrumentation` records the incoming request as a server span, `AddHttpClientInstrumentation` records each outbound call as a client span, and `AddSource` opts your own `ActivitySource` names into the pipeline. Without the `AddSource` call your spans are created but never exported, which is the most common reason a service looks completely uninstrumented.

### Instrumenting your own code

Use a static `ActivitySource` per subsystem, start an activity with `StartActivity`, attach attributes, and set the status. The `using` disposes the span and records its duration.

```csharp
private static readonly ActivitySource Source = new("Orders.Pipeline");

using var activity = Source.StartActivity("EnrichOrder");
activity?.SetTag("order.id", order.Id);
activity?.SetTag("order.item_count", order.Items.Count);
activity?.SetStatus(ActivityStatusCode.Ok);
```

## Context propagation across hops

OpenTelemetry follows the W3C Trace Context specification. The current span's identifiers travel in the `traceparent` header of every outbound call, and the receiving service reads them to continue the same trace rather than starting a new one. `HttpClient` instrumentation injects the header automatically; you only handle it yourself for queues and custom transports, where you copy the trace context into the message metadata and restore it on the consumer.

`Activity.Current` is the ambient span, so any code on the same async flow can read it and attach a child without threading a parameter through every method. That ambient behaviour is also why you must not leak an activity into a background task started without the flow, because the parent relationship recorded would be wrong.

### Sampling decides the bill

- Head sampling decides at the root whether to record; `TraceIdRatioBased` keeps a fixed percentage and is cheap.
- Tail sampling decides after the trace completes, so it can keep errors and slow requests but needs the spans buffered first.
- `AlwaysOn` records everything and belongs only in development.
- Untagged, unsampled spans still cost serialization, so keep instrumentation purposeful.

## What traces answer that logs do not

Traces answer where a request spent its time, not what a single line of code printed. A span that is wide relative to its parent is the hop to investigate, and comparing a slow trace to a fast one of the same endpoint shows the difference without guessing.

The trade-off is volume. Instrumenting everything produces traces that are expensive to store and noisy to read, so instrument the boundaries that matter, sample in production, and add attributes that let you filter by tenant, endpoint and outcome rather than logging every intermediate value.
