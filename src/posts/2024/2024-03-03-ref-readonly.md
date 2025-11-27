---
title: 'C# 12 features: ref readonly'
date: '2024-03-03T07:00:00.000+10:30'
image: ../../assets/2024/03/logo_csharp.png
tags:
- .NET
---

_Part 3 in a series on new language features in C# 12._

![C# logo](../../assets/2024/03/logo_csharp.png)

## `ref readonly` modifier

A bit more of a niche feature - if you have code that is passing structs by `ref`, but you don't need to (or want to) allow modification of the parameter, you can now indicate it is readonly.

```csharp
    public static void ByRefReadonly(ref readonly Point p)
    {
        //p = new Point(2, 3);
        Console.WriteLine(p);

    }
```

In the code sample above, `Point` is a struct or record type. If you uncommented the line then the compiler will emit an error.

Interesting, but I've not come across a need to use this yet.

### Further reading

[https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/method-parameters?WT.mc_id=DOP-MVP-5001655#ref-readonly-modifier](https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/method-parameters?WT.mc_id=DOP-MVP-5001655#ref-readonly-modifier)

### Example source

[https://github.com/flcdrg/csharp-12/blob/main/02-collection-expressions/CollectionExpressions.cs](https://github.com/flcdrg/csharp-12/blob/main/02-collection-expressions/CollectionExpressions.cs)
