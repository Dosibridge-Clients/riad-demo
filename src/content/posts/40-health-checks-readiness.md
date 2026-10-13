---
title: "Health Checks, Readiness and Liveness for .NET Services"
slug: "health-checks-readiness"
excerpt: "Liveness and readiness answer different questions. Conflating them turns a slow database into a restart loop, so tag the checks and expose them separately."
category: "Performance & Diagnostics"
tags: ["health-checks", "kubernetes", "operations"]
date: "2026-02-20"
level: "Advanced"
author: "Riad"
---

A health endpoint is a contract with the orchestrator, and the orchestrator acts on it destructively. Kubernetes restarts a pod whose liveness probe fails and removes from load balancing a pod whose readiness probe fails. If both endpoints run the same comprehensive check, a temporarily unreachable dependency fails liveness, the pod is killed, and the restart makes the outage worse. The fix is to separate the questions and answer each with the narrowest check that is still honest.

## Three different questions

Liveness asks whether the process is deadlocked and cannot recover; failure should restart it. Readiness asks whether it can serve traffic right now; failure should remove it from the load balancer without killing it. Startup asks whether a slow-initializing process has finished booting, so the liveness probe can be lenient until then.

The naming is the trap. Many teams map a single `/health` endpoint and point both probes at it, which works until a dependency wobbles, at which point Kubernetes kills healthy pods in a loop. Splitting the endpoints is not extra work; it is the difference between a self-healing service and a self-destroying one.

## Registering tagged health checks

`AddHealthChecks` registers checks, and each carries tags. `MapHealthChecks` maps an endpoint with a predicate that selects which tags it runs, which is how one registration feeds several probes with different semantics.

```csharp
builder.Services.AddHealthChecks()
    .AddCheck<SelfHealthCheck>("self", tags: ["live"])
    .AddCheck<DatabaseHealthCheck>("database", tags: ["ready"]);

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("live"),
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("ready"),
});
```

### Writing a dependency check

A check implements `IHealthCheck` and returns a `HealthCheckResult`. Keep it cheap, give it a timeout, and never let it retry for long, because the probe itself is on a deadline.

```csharp
public sealed class DatabaseHealthCheck : IHealthCheck
{
    private readonly AppDbContext _db;
    public DatabaseHealthCheck(AppDbContext db) => _db = db;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken ct = default)
    {
        return await _db.Database.CanConnectAsync(ct)
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("database unreachable");
    }
}
```

## Health checks that cause outages

Most incidents blamed on health checks come from putting the wrong thing in the liveness endpoint.

- Checking a downstream dependency in liveness turns its slowdown into your restart storm.
- Running an expensive query in either endpoint adds load that scales with the probe interval.
- Omitting a timeout lets a hung check block the probe until the kubelet kills the pod.
- Returning `Healthy` unconditionally hides the fact that the service cannot serve.

## Wiring the probes

In Kubernetes the container declares `livenessProbe`, `readinessProbe` and `startupProbe`, each with a `path`, `port` and timing. Point the readiness probe at the endpoint with the dependency checks and the liveness probe at the endpoint with only the self-check, and use the startup probe to cover initialization.

Give the readiness probe a shorter period and a higher failure threshold than the liveness probe, because a readiness false positive is cheap and a liveness false positive is not. A `startupProbe` with a generous failure threshold lets a service that takes thirty seconds to warm up pass liveness without being declared dead on the way.

The trade-off is sensitivity against stability. A readiness check that includes a slow dependency keeps traffic off a struggling pod, but its flapping can throttle a service that is only briefly degraded, so tune the failure threshold and period to the dependency's real recovery time rather than to the default.
