---
title: "Output Caching vs Response Caching vs Distributed Cache"
slug: "output-caching-vs-response-caching"
excerpt: "Response caching, output caching and IDistributedCache solve different problems. Confusing them leads to stale payloads, per-node inconsistency and wasted memory."
category: "ASP.NET Core"
tags: ["caching", "output-cache", "http-cache"]
date: "2026-08-31"
level: "Advanced"
author: "Riad"
---

Three caching mechanisms ship in the ASP.NET Core toolbox and they are routinely confused. Response caching is HTTP-cache aware and per-node. Output caching is server-side and authoritative. `IDistributedCache` is a generic key-value store with no HTTP awareness at all. Picking the wrong one produces stale responses, inconsistent nodes, or a cache that quietly never hits.

## Response caching

`AddResponseCaching` plus `UseResponseCaching` implements the HTTP caching contract. It reads `Cache-Control`, `Expires`, `Vary` and conditional headers from the request and constructs a matching response, and it only caches responses that the endpoint or a proxy declared cacheable. Because it honours client directives, a request with a bypass header skips it, which is correct for HTTP semantics but surprising when you expected a guaranteed server cache. It stores entries in memory on the local node only.

## Output caching

Output caching is the server-authoritative option introduced in .NET 7. `AddOutputCache` and `UseOutputCache` cache the full response server-side and ignore the client's `Cache-Control`, because the server decides what is cacheable, not the caller. Policies are defined once and applied with `.CacheOutput("policy")` on endpoints or `[OutputCache]` on controllers. It supports vary-by rules on query, header, route values and more, plus tag-based eviction so a write can invalidate a related set.

### Vary-by keys and eviction

The cache key is the combination of the request path and every vary-by rule. Omit a rule and you serve one user's response to another. Invalidate deliberately with tags rather than waiting for expiry:

```csharp
builder.Services.AddOutputCache(options =>
{
    options.AddPolicy("product", policy => policy
        .Expire(TimeSpan.FromMinutes(5))
        .SetVaryByQuery("currency", "locale")
        .SetVaryByHeader("Accept-Language")
        .Tag("catalog"));
});

// after a product mutation, evict the whole catalog tag
await outputCacheStore.EvictByTagAsync("catalog", ct);
```

To make output caching work across a fleet, register a shared store instead of the default in-memory one. In .NET 8 that is a single call to `AddStackExchangeRedisOutputCache`, and the same policies then apply cluster-wide.

## IDistributedCache

`IDistributedCache` is an abstraction over Redis, SQL Server or a similar store. It exposes byte-oriented `Get`, `Set`, `Refresh` and `Remove`. It has no concept of routes, content types, or HTTP headers. You use it to cache data your code fetches, such as a serialized aggregate, not to cache HTTP responses. It also does not handle stampede protection, vary-by keys, or eviction tags for you.

Memory is the other axis to weigh. Output caching retains full response bodies, including headers and content type, so a large catalog with many vary-by combinations can balloon the in-memory store. Set a `SizeLimit` on the cache and a `Size` per policy, or the process grows until the host reclaims it under pressure. Response caching has the same footprint with less control, which is another reason output caching is the default server-side choice.

## The trade-off

Output caching saves the entire request pipeline and is the highest-leverage cache, but you must define vary-by keys carefully and evict on writes or accept staleness. Response caching respects HTTP semantics and is the right choice when intermediaries must cooperate, yet it caches per node and can be bypassed. `IDistributedCache` is the most flexible and the most manual; beyond a handful of keys, add HybridCache rather than hand-rolling serialization and invalidation.
