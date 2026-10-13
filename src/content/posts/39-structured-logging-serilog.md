---
title: "Structured Logging with Serilog: Enrichment, Sinks and Levels"
slug: "structured-logging-serilog"
excerpt: "Structured logging captures named properties, not a formatted string, so logs stay queryable. Serilog enrichment and sinks decide what ships and where."
category: "Performance & Diagnostics"
tags: ["logging", "serilog", "observability"]
date: "2026-02-26"
level: "Advanced"
author: "Riad"
---

A log line that reads "Order 42 failed" is a fact you can read and nothing you can query. A structured log event captures `OrderId = 42` as a property, so you can filter, count and group by it later. Serilog is built around that idea, and its enrichment, sink and level configuration decides what actually reaches the log store and how much it costs.

## Message templates, not interpolated strings

`ILogger<T>` accepts a message template with named placeholders and the values as separate arguments. The template is the event's identity; the values are its properties. Interpolating first destroys the structure and forces any downstream parser to guess.

```csharp
logger.LogInformation("Order {OrderId} shipped to {Region}", order.Id, order.Region);
```

The same rule applies when the values are expensive to compute. Guard with `logger.IsEnabled(LogLevel.Debug)` or use a source-generated method, so you do not pay for a computation that will be discarded anyway.

### Enrichment adds context to every event

Enrichment attaches properties to every event without threading them through each call.

```csharp
builder.Host.UseSerilog((ctx, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("service", "orders-api")
    .Enrich.WithMachineName());
```

`FromLogContext` reads properties you push into a scope, which is how a correlation identifier or tenant identifier travels across a request. `WithProperty` adds a fixed value, and the enrichers for machine name, thread and environment remove the temptation to interpolate them into the message text.

## Pushing scoped context

```csharp
using (LogContext.PushProperty("CorrelationId", correlationId))
{
    logger.LogInformation("Processing payment");
}
```

The `using` disposes the pushed property when the scope ends, so the property applies exactly to the work inside it and does not leak into unrelated events.

## Levels, overrides and sinks

Levels express intent: `Information` for business events, `Warning` for recoverable conditions, `Error` for failures needing attention. The minimum level is a floor, and `MinimumLevel.Override` raises or lowers it per source, which is how you quiet a chatty framework without losing your own detail.

- Console and file sinks for local and container output.
- A structured sink such as Seq, Elasticsearch or a cloud log service for querying.
- A rolling file sink with a size or day limit so one host cannot fill its disk.
- A batching or async wrapper so logging never blocks the request path.

Configure the file sink's `retainedFileCountLimit` and `rollingInterval` explicitly, because the defaults keep a bounded history and silently drop old files, which surprises teams in the middle of an incident.

## Source-generated logging for hot paths

The `[LoggerMessage]` attribute generates a strongly typed logging method at compile time, which avoids boxing the arguments and skips the template parsing done at runtime. On a path that logs thousands of times a second, that difference shows up in the profile.

The trade-off is ingestion cost and noise. Every property you attach and every level you leave enabled is storage and query load, so log boundaries and errors at a high level, keep verbose detail behind an override you can toggle, and enrich with context that helps you filter rather than context that merely describes.
