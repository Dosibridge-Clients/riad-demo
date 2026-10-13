---
title: "Reflection vs Compiled Expressions vs Source-Generated Mapping"
slug: "reflection-vs-expressions-mapping"
excerpt: "Reflection is flexible and slow, compiled expressions are fast and fiddly, source generators are fastest and rigid. Pick by how often the path runs."
category: "Performance & Diagnostics"
tags: ["reflection", "expressions", "mapping"]
date: "2026-02-08"
level: "Advanced"
author: "Riad Hossain"
---

Every mapper, serializer and object-to-object converter answers the same question: how do I call a property setter when I only know its name at runtime? There are three answers, and they sit on a spectrum from unlimited flexibility to zero. Reflection calls the setter through metadata on every invocation. Compiled expressions build a delegate once, then call it at near hand-written speed. Source generators emit the delegate as compiled C#, so there is nothing to build at runtime at all. The mistake is picking one for the whole application instead of matching the tier to the call site.

## Reflection: correct but priced per call

`PropertyInfo.SetValue` is not slow because reflection is bad; it is slow because each call re-does argument validation, boxing of value types and access-check work that a compiler would have done once. On a cold path — a startup scan, an admin tool, a one-off import — that is fine and the flexibility is worth it.

```csharp
public static TTarget Map<TTarget>(object source) where TTarget : new()
{
    var target = new TTarget();
    var props = typeof(TTarget).GetProperties(BindingFlags.Public | BindingFlags.Instance);
    foreach (var prop in props)
    {
        var value = source.GetType().GetProperty(prop.Name)?.GetValue(source);
        if (value is not null) prop.SetValue(target, value);
    }
    return target;
}
```

Note the caching trap: the `GetProperty` lookups above run on every invocation. At minimum, cache the `PropertyInfo` arrays in a `static readonly` field keyed by type.

### Compiled expressions

`Expression.Lambda<Func<TSource, TTarget>>` builds a lambda tree once and `Compile()` turns it into a real delegate. The cost is the compile step — tens of milliseconds for a large graph — amortised across every subsequent call. This is the sweet spot for a type pair you map constantly but cannot see at build time, such as plugin types loaded from an assembly.

```csharp
private static readonly ConcurrentDictionary<(Type, Type), Delegate> Cache = new();

public static Func<TSource, TTarget> GetMapper<TSource, TTarget>()
{
    return (Func<TSource, TTarget>)Cache.GetOrAdd((typeof(TSource), typeof(TTarget)), static key =>
    {
        var source = Expression.Parameter(key.Item1, "s");
        var bindings = key.Item2.GetProperties()
            .Select(p => (MemberBinding)Expression.Bind(p, Expression.Property(source, p.Name)));
        var body = Expression.MemberInit(Expression.New(key.Item2), bindings);
        return Expression.Lambda(body, source).Compile();
    });
}
```

`Compile()` is not free and it is not trimmable-friendly; every shape you compile stays in memory as compiled IL.

## Source-generated mapping

A generator emits the same assignments as literal C# at build time. No compile step, no cache, no reflection, and it works under AOT and trimming because there is no metadata access to block. The trade-off is rigidity: the map exists only for the pairs the generator saw, and a runtime type never gets one.

- Startup or admin path, unknown types: reflection, with cached metadata.
- Frequently hit path, types known only at runtime: compiled expressions.
- Frequently hit path, types known at build time: source-generated.
- AOT or trimmed publish: source-generated, or reflection is disabled by the trimmer.

## The trade-off

Reflection buys you working code in ten lines and charges you per call. Compiled expressions buy speed and charge you a cold-start compile plus real difficulty when a property is missing or a conversion fails. Source generators buy the best runtime and charge you build complexity and a hard boundary at compile time. Measure the call site before choosing; most applications need the generator for their hot mapping and reflection everywhere else.
