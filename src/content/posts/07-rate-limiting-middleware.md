---
title: "Rate Limiting Middleware: Partitioning, Policies and Queues"
slug: "rate-limiting-middleware"
excerpt: "The built-in rate limiting middleware partitions requests into policies and queues. Misconfigure partitioning and rejection and you get fairness bugs under load."
category: "ASP.NET Core"
tags: ["rate-limiting", "throttling", "reliability"]
date: "2026-09-06"
level: "Advanced"
author: "Riad Hossain"
---

Since .NET 7 the framework ships rate limiting in the box, built on the `System.Threading.RateLimiting` primitives. It is not a bolt-on; it is middleware that plugs into the same pipeline as everything else. The subtle part is not the algorithm, it is the partitioning key and the queue behaviour, and both have defaults that bite under real load.

## Policies and algorithms

`AddRateLimiter` registers the middleware and a set of named policies. Each policy wraps one of four limiter types. `FixedWindowRateLimiter` allows N requests per window and resets hard at the boundary. `SlidingWindowRateLimiter` smooths the boundary spike. `TokenBucketRateLimiter` refills at a steady rate and tolerates bursts up to the bucket size. `ConcurrencyLimiter` caps simultaneous in-flight work rather than arrival rate, which is what you usually want when protecting a slow backend.

Policies attach globally, by endpoint name, or by convention. `RequireRateLimiting("policy")` on an endpoint or `MapGroup` is the explicit form; `EnableRateLimiting` does the same for controllers.

### Partitioning is where fairness lives

A single global limiter throttles everyone together. A partitioned limiter gives each key its own budget, so one noisy client cannot starve the rest. The key selector is the whole game:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy("per-api-key", context =>
    {
        var key = context.Request.Headers["X-Api-Key"].FirstOrDefault() ?? "anonymous";
        return RateLimitPartition.GetTokenBucketLimiter(key, _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 100,
            TokensPerPeriod = 20,
            ReplenishmentPeriod = TimeSpan.FromSeconds(1),
            QueueLimit = 10,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            AutoReplenishment = true,
        });
    });
});
```

Keying on an unauthenticated source such as a raw IP address is common but blunt behind a proxy; resolve the real client first or every request shares the proxy's partition.

## Queues and rejection

`QueueLimit` controls how many requests wait for a token instead of being rejected immediately. Queuing smooths bursts but parks the request on a held connection, consuming a thread or an async continuation until a token frees up. Set it to zero for latency-sensitive endpoints and allow a small queue only where a short wait beats a 429. The default rejection writes a 503; you almost always want 429 with a `Retry-After` header, so override `OnRejected` to add it.

## The trade-off

In-process limiting is fast and dependency-free, but it is per-node. Behind a load balancer each replica enforces its own budget, so a global limit of 1,000 becomes 1,000 times the replica count. Either divide the limit by the fleet size as a rough guard, or push the policy to a shared store or an API gateway for a true global ceiling. The middleware is excellent as a local safety valve and insufficient as a billing-grade quota.

A global limiter and named policies compose. `GlobalLimiter` can be a `PartitionedRateLimiter` produced by `PartitionedRateLimiter.CreateChained`, letting you enforce a coarse per-IP ceiling and a finer per-endpoint budget in one pipeline. Pipeline order matters here too: rate limiting must run after you can identify the caller. Place it before authentication when the key comes from a claim, and every request partitions as anonymous, which silently collapses the policy into a single shared bucket.
