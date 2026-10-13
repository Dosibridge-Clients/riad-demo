---
title: "Hybrid Caching and Cache Stampede Protection"
slug: "hybrid-cache-stampede-protection"
excerpt: "A cache stampede overloads your backend when a hot key expires. HybridCache and per-key locking both stop it, with different trade-offs in complexity and latency."
category: "ASP.NET Core"
tags: ["caching", "stampede", "fusioncache"]
date: "2026-08-25"
level: "Advanced"
author: "Riad Hossain"
---

A cache stampede, sometimes called a thundering herd or dogpile, is what happens when a popular cache entry expires and every concurrent request that wanted it simultaneously misses and recomputes. The first request to miss is expected work. The five thousand that miss in the same millisecond will hammer your database with identical queries and can take the whole tier down.

## Why the naive cache fails under load

A read-through cache looks safe: check the cache, on miss compute and store, return the value. With one caller it is fine. With thousands of callers arriving between the expiry and the first write-back, all of them observe a miss and all of them run the expensive path. The cache does not protect anything at the exact moment it matters most. TTL jitter reduces the odds of a synchronised expiry but does nothing for a key that is genuinely hot and requested continuously.

### Three mechanisms that work

- Locking: a per-key mutual exclusion so exactly one caller recomputes while the others wait and then read the fresh value.
- Early refresh: serve the stale value immediately and refresh it in the background, so no caller ever blocks on recomputation.
- Probabilistic early expiration: recompute slightly before expiry with a probability that rises as the entry ages, spreading the refresh across callers.

## HybridCache in .NET 9

`Microsoft.Extensions.Caching.Hybrid` packages a two-level cache with stampede protection built in. Level one is in-memory and instant; level two is a distributed store such as Redis shared across the fleet. The key API is `GetOrCreateAsync`, which guarantees a single factory invocation per key under contention.

```csharp
builder.Services.AddHybridCache(options =>
{
    options.DefaultEntryOptions = new HybridCacheEntryOptions
    {
        Expiration = TimeSpan.FromMinutes(10),
        LocalCacheExpiration = TimeSpan.FromMinutes(1),
    };
});

public sealed class ProductService(HybridCache cache, IDbContextFactory<AppDbContext> factory)
{
    public ValueTask<ProductDto> GetAsync(int id, CancellationToken ct) =>
        cache.GetOrCreateAsync(
            $"product:{id}",
            async token =>
            {
                await using var db = await factory.CreateDbContextAsync(token);
                return await db.Products.AsNoTracking()
                    .Where(p => p.Id == id)
                    .Select(p => new ProductDto(p.Id, p.Name, p.Price))
                    .SingleAsync(token);
            },
            cancellationToken: ct);
}
```

Tag the entry to evict related keys on a write, and set `LocalCacheExpiration` shorter than `Expiration` so the fast in-memory layer never serves a stale value for longer than you can tolerate.

## Doing it by hand

Without HybridCache you implement per-key locking with a `ConcurrentDictionary<string, SemaphoreSlim>` and a double-check of the cache after acquiring the lock. It works, but you own the dictionary lifetime, the removal of idle semaphores, and the exception paths. Get any of those wrong and you leak or deadlock.

## The trade-off

HybridCache serialises recomputation for you and collapses two cache layers into one registration, at the cost of a serialization round-trip for the distributed layer and a dependency on the serializer's supported types. Hand-rolled locking gives total control and no new dependency, but it is easy to get subtly wrong and hard to test under real contention. For most services the package is the better default.

Choose the local expiration deliberately. A one-minute in-memory TTL on top of a ten-minute distributed TTL means a burst on a single node is served instantly from memory while other nodes pull from the shared layer. If reads must be consistent across nodes immediately after a write, tag the entry and evict through the distributed store instead of waiting for the timers to converge.
