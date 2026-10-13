---
title: "Native AOT, Trimming and Lean Container Images"
slug: "aot-trimming-container-images"
excerpt: "Trimming and Native AOT shrink images and startup, but reflection and runtime code generation break. Root what must survive and remove the rest."
category: "Cloud & Deployment"
tags: ["aot", "trimming", "containers"]
date: "2025-10-29"
level: "Advanced"
author: "Riad"
---

Publishing a .NET service as a native image removes the runtime, the JIT and, with trimming, code the linker believes is unreachable. The payoff is a container that starts in tens of milliseconds and a base image measured in tens of megabytes. The cost is that the two things that make this possible — the linker's reachability analysis and ahead-of-time compilation — both depend on what the code statically looks like, so anything reached only by reflection, dynamic dispatch or a serialiser that generates code at runtime can vanish or fail the moment it is used.

## What trimming actually does

The trimmer builds a graph from your entry point and marks everything reachable through static references; assemblies, types and members nothing references are removed. Reflection breaks that analysis: a type instantiated by `Activator.CreateInstance`, a property set by a JSON serialiser by name, a controller discovered by convention all look unreachable even though they are called. The result is a smaller image that throws `MissingMethodException` or returns an empty deserialised object at runtime, on the path exercised least.

```xml
<PropertyGroup>
  <PublishAot>true</PublishAot>
  <PublishTrimmed>true</PublishTrimmed>
  <InvariantGlobalization>true</InvariantGlobalization>
  <TrimMode>full</TrimMode>
</PropertyGroup>
<ItemGroup>
  <TrimmerRootAssembly Include="MyApp.Plugins" />
</ItemGroup>
```

### Roots and source-generated serialisation

When a genuine reflection dependency must survive, you tell the trimmer: `TrimmerRootAssembly` keeps an assembly whole, and `DynamicDependency` or a root descriptor keeps specific members. The cleaner fix is to remove the reflection. For JSON, that means System.Text.Json source generation: annotate a context with `JsonSerializable` and the serialiser uses generated code instead of runtime reflection, which is both trim-safe and faster.

```csharp
[JsonSerializable(typeof(Order))]
[JsonSerializable(typeof(List<Order>))]
internal partial class AppJsonContext : JsonSerializerContext;
```

## The AOT compiler's assumptions

Native AOT compiles to a single executable ahead of time, which forbids runtime code generation. So no `Reflection.Emit`, no runtime expression compilation, no `dynamic` over a type the compiler cannot see. Many libraries depend on exactly that: a DI container that emits factory delegates, an ORM that builds queries dynamically. Before committing to AOT, read the trim and AOT analyser warnings, because they are the tool telling you which dependencies will break, and treat each as a decision rather than noise. Containerising the result is then trivial, since there is no runtime to ship.

## Lean container images

A native image needs no .NET runtime layer, so the final stage can be a minimal base or even `scratch` with only your binary and the ICU or libc it needs. Set `InvariantGlobalization` and you drop the ICU dependency, at the cost of culture-aware formatting and collation — a real trade for anything that formats dates or sorts user text. Build in a stage with the SDK, copy just the published binary into the runtime stage, and the image is the size of your code plus the C library.

## The trade-off

Native AOT buys startup latency, memory footprint and container size, and pays with build time, toolchain complexity and a smaller set of usable libraries. The startup it saves matters most for scale-to-zero and CLI-shaped workloads; a long-running server that starts once has less to gain. Trimming without AOT shrinks the image but keeps the runtime, and it is easier to adopt incrementally. Enable trimming first, fix the warnings, and move to AOT only when a measurable requirement such as cold start or image size justifies the constraints.
