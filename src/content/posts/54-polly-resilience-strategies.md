---
title: "Resilience with Polly: Retries, Circuit Breakers and Timeouts"
slug: "polly-resilience-strategies"
excerpt: "Retries without limits amplify outages. Polly pipelines compose timeout, retry and circuit breaker so each bounds a different failure, in the right order."
category: "Messaging & Distributed Systems"
tags: ["polly", "resilience", "fault-tolerance"]
date: "2025-11-28"
level: "Advanced"
author: "Riad"
---

Retries alone are not resilience, they are amplification. The classic outage is a dependency that slows down, callers that retry every failure, and a retry storm that finishes the job the struggling dependency could not. In .NET 8 and 9, Polly is expressed through `ResiliencePipeline` and the `Microsoft.Extensions.Http.Resilience` integration, and the point of composing strategies is that each one bounds a different failure: a timeout bounds a single attempt, a retry bounds transient ones, and a circuit breaker bounds the whole client when the dependency is genuinely down.

## Composing handlers

`AddResilienceHandler` attaches a pipeline to an `HttpClient` created by `IHttpClientFactory`, and the order in which you add strategies inside the callback is the order they nest, outermost first. Get it wrong and you build the storm you were avoiding: a retry placed outside a timeout retries the timeout, so every attempt is itself retried and the worst case multiplies.

```csharp
builder.Services.AddHttpClient<BillingClient>()
    .AddResilienceHandler("billing", b =>
    {
        b.AddTimeout(TimeSpan.FromSeconds(2));

        b.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 3,
            BackoffType = DelayBackoffType.Exponential,
            UseJitter = true,
            Delay = TimeSpan.FromMilliseconds(200),
        });

        b.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5,
            SamplingDuration = TimeSpan.FromSeconds(30),
            MinimumThroughput = 10,
            BreakDuration = TimeSpan.FromSeconds(15),
        });
    });
```

### Ordering and the timeout budget

Read the pipeline inward: the timeout wraps the transport call, the retry wraps the timeout, the breaker wraps the retry, and any outer total timeout wraps everything. The inner budget must be smaller than the outer one, or four attempts of a two-second timeout run longer than the caller is willing to wait. Exponential backoff with jitter spreads retries so a fleet recovering from a blip does not hit the dependency in lockstep, which is what turns a small recovery into a second outage.

## Circuit breakers versus retries

A retry assumes the failure is transient and the same call will soon succeed. A circuit breaker assumes the dependency is down and stops calling it, failing fast so your own threads are not consumed waiting; it probes with a single request after the break duration and closes again on success. The two are complementary: retries handle the blip, the breaker handles the outage. A breaker without retries gives up too early on one bad response, and retries without a breaker keep hammering a service that is already failing.

## Timeouts and cancellation

A client timeout does not cancel server-side work, it only abandons the wait, so set timeouts slightly above your measured p99 rather than at a round number and pass the incoming cancellation token through so work stops here when the caller has given up. Nesting a two-second timeout inside an incoming token that expires in one second is pointless, because the outer token fires first and the inner limit never engages.

## The trade-off

Resilience policies add latency on the failure path by design: a correctly retried failure is slower than a fast failure, and that is the price of surviving transients. They also add a configuration surface tuned per dependency, because a database wants a different breaker than a third-party API. Use `ResiliencePipelineProvider` to define named pipelines once and inject them by name so the tuning lives in one place, and never wrap a genuinely non-transient failure such as a validation rejection in a retry, because that only delays the honest error.
