---
title: "Span, Memory and ArrayPool for Allocation-Free Code"
slug: "span-memory-arraypool"
excerpt: "Span<T> slices without copying, Memory<T> carries that idea across awaits, and ArrayPool<byte> recycles the buffers so the GC never sees them."
category: "Performance & Diagnostics"
tags: ["span", "memory", "allocation"]
date: "2026-03-28"
level: "Advanced"
author: "Riad Hossain"
---

Most avoidable allocations in a .NET hot path come from slicing strings and arrays. Every `Substring` and `ToArray` allocates, and on a request path that runs thousands of times a second those allocations are what push Gen0 collections and pauses into the latency tail. `Span<T>` and `Memory<T>` let you view a region of existing memory without copying it, and `ArrayPool<T>` lets you reuse the buffer underneath so it never becomes garbage.

## Span is a view, not a container

`Span<T>` is a `ref struct`, which means it can only live on the stack. That is the source of its speed and its main constraint: you cannot store it in a field of a class, use it across an `await`, or box it. It wraps a reference and a length, so slicing one is an arithmetic operation rather than a copy.

```csharp
public static bool TryReadLength(ReadOnlySpan<byte> buffer, out int length)
{
    if (buffer.Length < sizeof(int))
    {
        length = 0;
        return false;
    }

    length = BinaryPrimitives.ReadInt32BigEndian(buffer);
    return true;
}
```

A slice of a `Span<T>` shares the same memory, so `buffer[4..]` and `buffer.Slice(4, 8)` produce views that cost nothing and cannot alter the underlying allocation. `stackalloc` builds a span over stack memory for a small scratch buffer, which allocates nothing at all but must stay small, because the stack is finite and an overflow is unrecoverable. The rule of thumb is that anything past a few hundred bytes belongs in a pooled heap buffer rather than on the stack.

### Span versus Memory

`Memory<T>` is the heap-safe counterpart of `Span<T>`. It is not a `ref struct`, so it can be a field, a parameter in an `async` method, or part of a generic type; you call `.Span` to get a `Span<T>` for the synchronous part of the work. Use `Span<T>` for synchronous parsing and hot loops, and `Memory<T>` when the buffer has to survive across an `await`.

## Reusing buffers with ArrayPool

`ArrayPool<byte>.Shared.Rent(size)` returns a pooled array that is at least `size` long, possibly longer. You must not assume its length, and you must return it in a `finally`. Slicing to the logical length with `AsSpan(0, count)` keeps the extra capacity out of your logic.

```csharp
byte[] buffer = ArrayPool<byte>.Shared.Rent(minimumLength: 4096);
try
{
    int read = await stream.ReadAsync(buffer.AsMemory(0, 4096), ct);
    Process(buffer.AsSpan(0, read));
}
finally
{
    ArrayPool<byte>.Shared.Return(buffer);
}
```

`ArrayPool<byte>.Create(maxArrayLength, maxArraysPerBucket)` builds a private pool when you want isolation from the shared one, which matters when a large-array workload would otherwise evict the small buffers every other component depends on.

### The mistakes that bite

- Returning the same array twice corrupts the pool for another caller.
- Touching the array after returning it is a use-after-free that only shows up under concurrency.
- Using the full rented length instead of the logical length leaks stale bytes into the output.
- Skipping `clearArray: true` on secret-bearing buffers leaves credentials in pooled memory.
- Pooling very large arrays keeps them alive far longer than the collector would.

The trade-off is that pooling exchanges a GC pause for manual ownership. The pool is fast precisely because it is not thread-safe and because it never clears data, so every rented buffer needs an explicit contract about who owns it and when it goes back.
