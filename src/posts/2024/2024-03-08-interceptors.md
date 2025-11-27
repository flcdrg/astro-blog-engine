---
title: 'C# 12 features: Interceptors'
date: '2024-03-08T07:00:00.000+10:30'
image: ../../assets/2024/03/logo_csharp.png
tags:
- .NET
---

_Part 8 in a series on new language features in C# 12._

![C# logo](../../assets/2024/03/logo_csharp.png)

## Interceptors

This is an experimental feature that is disabled by default. It is an enhancement that source generators will be able to take advantage of. It allows source generators to modify (replace) existing code, rather than just adding new code.

Being an experimental feature, the implementation details are likely to change over time, and there's no guarantee that it will necessarily ship as a regular feature in the future.

### Further reading

[https://github.com/dotnet/roslyn/blob/main/docs/features/interceptors.md](https://github.com/dotnet/roslyn/blob/main/docs/features/interceptors.md)

### Example source

[https://github.com/flcdrg/csharp-12/tree/main/08-interceptors](https://github.com/flcdrg/csharp-12/tree/main/08-interceptors)
