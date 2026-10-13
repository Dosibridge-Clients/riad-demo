---
title: "A Production Readiness Checklist for .NET Services"
slug: "production-readiness-checklist-dotnet"
excerpt: "Readiness is a list of failures already handled, not a feature. Liveness, shutdown, config, telemetry and dependencies, in the order they bite."
category: "Cloud & Deployment"
tags: ["operations", "readiness", "checklist"]
date: "2025-10-23"
level: "Advanced"
author: "Riad Hossain"
---

A service is ready for production when a specific set of failures is already handled, and the gap between a demo and a system is exactly that list. Readiness is not a feature; it is the collection of decisions about liveness, shutdown, configuration, observability and dependencies that you either make deliberately or inherit as incidents. The checklist below is the one I run before a .NET service takes real traffic, ordered by what bites first.

## Liveness, readiness and the difference

Liveness answers whether the process is healthy enough to keep; readiness answers whether this instance should receive traffic right now. Conflating them causes an outage: a service that is alive but still warming up receives traffic on a liveness check, or a deadlocked process is never restarted because its readiness check still returns healthy. Use `Microsoft.Extensions.Diagnostics.HealthChecks`, tag the checks and map separate endpoints.

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(builder.Configuration.GetConnectionString("Db")!, tags: ["ready"])
    .AddRabbitMQ(tags: ["ready"]);

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = reg => reg.Tags.Contains("live"),
});
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = reg => reg.Tags.Contains("ready"),
});
```

### Graceful shutdown

On `SIGTERM` the host stops accepting new work and drains in-flight requests up to the shutdown timeout. Set that timeout longer than your slowest request or you will cut requests mid-flight on every deploy. For a background worker, implement `IHostedService.StopAsync` to stop pulling from the queue and finish the current message before releasing the host, so a deploy does not abandon work that was already half done.

## Configuration and secrets

Configuration must come from the environment, not from a checked-in file, and secrets from a managed store rather than a variable that ends up in a crash dump. Validate options at startup with `ValidateOnStart`, so a missing connection string fails the boot instead of the first request. A service that starts without its configuration and only fails under load is worse than one that refuses to start.

## Observability you can act on

Structured logs with a correlation id, metrics for the four golden signals — latency, traffic, errors and saturation — and traces that span the service boundary are the minimum. A log line without a correlation id cannot be joined to the request that produced it, and a metric without a histogram hides the tail users actually feel. Export to a real backend before launch, because retrofitting telemetry after an incident teaches the wrong lessons at the worst time.

## The dependency and failure checklist

Walk every outbound dependency and answer what happens when it is slow, when it is down and when it returns garbage. Have a timeout on every call, a deliberate retry policy, and an honest degradation path for the ones you can live without. Confirm migrations run as a separate step or are backward-compatible with the running version, so a deploy is not also a schema change that breaks the previous release. Verify the build is reproducible, the image is pinned by digest, and the rollback is a tested operation rather than a hope.

## The trade-off

None of this is free: health checks add endpoints, graceful shutdown adds a drain window to every deploy, telemetry adds cost, and options validation adds a startup path. The alternative is meeting each of these as an incident, and the difference between teams is only whether they paid upfront or on a Saturday. Treat the checklist as a gate for the first production release and a review item afterwards, and prune the items that stop earning their keep.
