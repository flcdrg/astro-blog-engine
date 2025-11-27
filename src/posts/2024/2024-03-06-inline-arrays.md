---
title: 'C# 12 features: Inline arrays'
date: '2024-03-06T07:00:00.000+10:30'
image: ../../assets/2024/03/logo_csharp.png
tags:
- .NET
---

_Part 6 in a series on new language features in C# 12._

![C# logo](../../assets/2024/03/logo_csharp.png)

## Inline arrays

Super-niche, but I guess if you need it, you'll appreciate it. Previously you'd probably need to resort to using `unsafe` code to deal with this.

```csharp
[System.Runtime.CompilerServices.InlineArray(10)]
public struct InlineArray
{
    public int Thing;
}
```

The compiler now knows this is an array of 10 contiguous elements.

### Further reading

[https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/struct?WT.mc_id=DOP-MVP-5001655#inline-arrays](https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/struct?WT.mc_id=DOP-MVP-5001655#inline-arrays)

### Example source

[https://github.com/flcdrg/csharp-12/blob/main/06-inline-arrays/InlineArrays.cs](https://github.com/flcdrg/csharp-12/blob/main/06-inline-arrays/InlineArrays.cs)
