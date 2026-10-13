---
title: "IHttpClientFactory, Handler Rotation and Socket Exhaustion"
slug: "httpclient-factory-socket-exhaustion"
excerpt: "Creating an HttpClient per call exhausts ephemeral sockets, while a single static client never re-resolves DNS. IHttpClientFactory rotates handlers to fix both."
category: "ASP.NET Core"
tags: ["httpclient", "sockets", "resilience"]
date: "2026-09-30"
level: "Advanced"
author: "Riad"
---

There are two ways to use `HttpClient` badly and they pull in opposite directions. The first is `using var client = new HttpClient()` per call. The second is one `static readonly HttpClient` shared for the process lifetime. Neither is wrong by accident; each solves the other's problem while reintroducing its own.

## What each mistake costs

Disposing every client looks tidy and responsible. Under load it exhausts ephemeral ports. Disposing an `HttpClient` closes its underlying connection pool immediately, but the sockets spend time in `TIME_WAIT`, so a high-throughput service runs out of available ports and starts throwing `SocketException: Only one usage of each socket address is normally permitted`. The classic guidance to share one client fixes the ports and then breaks DNS: a long-lived `HttpClientHandler` caches the resolved IP address and never re-resolves, so a failover or blue-green cutover leaves your process talking to a host that no longer exists.

### The handler is the thing with the pool

`HttpClient` itself is cheap and disposable. The `HttpClientHandler` it wraps owns the connection pool, the proxy settings and the DNS cache. The lifetime problem is the handler's, not the client's, and that distinction is what the factory is built around.

## How IHttpClientFactory fixes both

The factory maintains a pool of handlers and rotates them every two minutes by default, controlled by `HandlerLifetime`. Handlers are returned to the pool rather than disposed when a client is disposed, so sockets are reused, while the periodic rotation guarantees a fresh handler and therefore fresh DNS resolution.

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddHttpClient<GitHubClient>(client =>
    {
        client.BaseAddress = new Uri("https://api.github.com/");
        client.DefaultRequestHeaders.UserAgent.ParseAdd("riad-demo/1.0");
        client.Timeout = TimeSpan.FromSeconds(10);
    })
    .SetHandlerLifetime(TimeSpan.FromMinutes(2))
    .AddStandardResilienceHandler();
```

Typed clients give you a configured, injected dependency; named clients let you resolve several configurations by string. Either way the pool, rotation and disposal are handled for you. `AddStandardResilienceHandler` layers retry, timeout, circuit breaker and hedging delegating handlers on top of the transport.

## The alternative: one long-lived handler

When you genuinely want a single client, configure `SocketsHttpHandler` directly, because its pool can recycle connections on a timer even while the handler lives on:

```csharp
builder.Services.AddSingleton(_ => new HttpClient(new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    PooledConnectionIdleTimeout = TimeSpan.FromMinutes(1),
    MaxConnectionsPerServer = 32,
}));
```

This is the recommended pattern for a process-wide client and avoids the factory entirely when you do not need per-call handler customisation.

Note that `SetHandlerLifetime` governs the handler, not the `HttpClient`, so short-lived clients created from the factory inherit the pool without triggering disposal. Rotate too aggressively and you lose connection reuse and the TLS handshake savings; rotate too slowly and stale DNS persists, so the two-minute default is a deliberate compromise between the two failure modes. Measure connection churn in your environment before tuning it.

## The trade-off

`IHttpClientFactory` adds an abstraction and a pool, and it does not magically add resiliency; you still configure handlers deliberately. The single static client is simpler and has marginally lower overhead, but you must set `PooledConnectionLifetime` yourself or accept stale DNS forever. For anything that talks to a backend that can move, the factory is the safer default.
