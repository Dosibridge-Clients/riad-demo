---
title: "BenchmarkDotNet: Microbenchmarks That Do Not Lie"
slug: "benchmarkdotnet-microbenchmarks"
excerpt: "A Stopwatch around a method measures the JIT, the warmup and the allocator as much as the code. BenchmarkDotNet removes the noise on purpose."
category: "Performance & Diagnostics"
tags: ["benchmarking", "performance", "measurement"]
date: "2026-03-16"
level: "Advanced"
author: "Riad"
---

Hand-rolled timing loops measure everything except what you asked about. The JIT has not compiled the method on the first iteration, the tiered compiler recompiles it later, the CPU caches are cold, and a result nobody consumes may be optimized away entirely. BenchmarkDotNet exists to isolate the method under test from those effects, and reading its output correctly is a skill in its own right.

## Why a Stopwatch loop lies

The first call to a method runs through the interpreter and tier-0 JIT; later calls run the tier-1 compiled code with better register allocation. A loop that averages all of them reports a blend of cold and hot code. Dead code elimination is worse: if the result of the call is unused, the runtime may skip the work entirely. BenchmarkDotNet runs a pilot phase, decides an iteration count, measures only the steady state, and consumes the return value so the work cannot be elided.

```csharp
[MemoryDiagnoser]
[SimpleJob(RuntimeMoniker.Net80)]
public class ParsingBenchmarks
{
    private readonly string _input = new string('a', 4096);

    [Benchmark(Baseline = true)]
    public int SpanParse() => SpanParser.Parse(_input.AsSpan());

    [Benchmark]
    public int StringParse() => StringParser.Parse(_input);
}
```

## Structuring a benchmark project

A benchmark class holds state in fields, builds that state in `[GlobalSetup]`, and exposes one method per variant with `[Benchmark]`. `[Params]` sweeps a value across the run, and `[Arguments]` pins specific inputs. The entry point calls `BenchmarkRunner.Run<T>`, which runs each method in its own process so one benchmark cannot contaminate another.

```csharp
var summary = BenchmarkRunner.Run<ParsingBenchmarks>();
```

### Setup that does not distort the measurement

- Build in release mode and never attach a debugger; a debug build changes codegen and timing.
- Put expensive setup in `[GlobalSetup]`, not in the constructor, which runs per iteration.
- Return or store the result so the JIT cannot delete the call.
- Keep the benchmark method to the code you actually want to compare, nothing more.

## Reading the report

The summary reports mean and standard deviation and, when you set a baseline, a ratio against it. `MemoryDiagnoser` adds allocated bytes per operation and garbage collection counts, which is often the number that matters more than time. A method that is ten percent faster but allocates four times as much is a regression on a server.

## The cases where microbenchmarks mislead

A microbenchmark measures a method in isolation, and isolation is exactly what production is not.

- Cache and branch prediction behave differently with real data than with a loop over one string.
- Contention, locking and thread-pool interference vanish in a single-threaded benchmark.
- A faster method can still lose overall if it allocates and pushes the collector.
- A warm compiler in the benchmark may not match the cold start of a short-lived process.

The trade-off is that microbenchmarks are precise about the wrong question if you forget what they omit. Use them to compare two implementations of one algorithm, then confirm the winner with a load test that includes the whole pipeline.
