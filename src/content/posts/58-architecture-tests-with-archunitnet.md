---
title: "Architecture Tests: Enforcing Boundaries with ArchUnitNET"
slug: "architecture-tests-with-archunitnet"
excerpt: "Architecture rules age badly when they live in a wiki. ArchUnitNET turns boundaries into tests, so one wrong using fails the build instead of a refactor."
category: "Testing & Quality"
tags: ["architecture-tests", "quality", "boundaries"]
date: "2025-11-04"
level: "Advanced"
author: "Riad"
---

Architecture rules live in the heads of the people who agreed to them, which means they last until the next hurried pull request. A diagram in a wiki does not fail a build. `ArchUnitNET` turns those rules into executable tests: you load your assemblies, express a rule over types and namespaces, and assert it holds. The boundary you drew — domain must not depend on infrastructure — becomes a red test the moment someone adds the wrong `using`, which is far cheaper than discovering the coupling during a refactor.

## Rules as tests over types

The library exposes a fluent API: define an `Architecture` by loading assemblies, describe a set of types with `Types().That().ResideInNamespace(...)`, and chain a `Should()` condition. The rule is evaluated against the loaded model, and a failure lists every offending type and the offending dependency, so the fix is obvious from the test output.

```csharp
using ArchUnitNET.Domain;
using ArchUnitNET.Loader;
using ArchUnitNET.xUnit;
using static ArchUnitNET.Fluent.ArchRuleDefinition;

private static readonly Architecture Architecture =
    new ArchLoader().LoadAssemblies(typeof(Order).Assembly).Build();

[Fact]
public void Domain_should_not_depend_on_infrastructure()
{
    Types().That().ResideInNamespace("MyApp.Domain")
        .Should().NotDependOnAny(Types().That().ResideInNamespace("MyApp.Infrastructure"))
        .Check(Architecture);
}
```

### Expressing a layered rule

A layered application is a set of directional rules: presentation may depend on application, application on domain, and domain on nothing but itself. Write each direction as its own rule so a failure names the specific violation rather than a vague cycle. The one-way domain rule is the one worth defending hardest, because a single reference from an entity to a repository abstraction is the seed of everything you were trying to avoid.

## Freezing the debt you already have

A rule that is correct and currently violated fails on day one and gets deleted or disabled, which is worse than no test at all. The pragmatic path is to record the existing violations as a baseline and fail only on new ones, then burn the baseline down as you touch those files. ArchUnitNET supports freezing rules against a stored set of violations, so a legacy boundary can be locked without blocking the team, and the frozen file becomes a to-do list with a shrinking length.

## Which rules earn their place

A rule is worth writing when it encodes a decision that is expensive to undo. Good candidates: the domain must not reference infrastructure; handlers must not call each other directly; no type outside the persistence layer may reference the ORM; every public service must implement an interface in a testable namespace. Bad candidates are rules nobody agreed to, because they produce arguments instead of protection, and rules so broad that the first legitimate exception forces you to weaken them into meaninglessness.

## The trade-off

Architecture tests run against compiled assemblies, so they see real dependencies and cannot be fooled by convention. That same property means they run after compilation, not before, so the feedback is slower than a linter and the rule is inert until the code compiles. They also add upkeep: refactoring a namespace means updating the rule. Keep the set small, make each one name a decision the team actually made, and the cost is a few minutes of maintenance for a boundary that holds.
