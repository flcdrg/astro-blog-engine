---
title: 'C# 12 features: Collection expressions'
date: '2024-03-02T07:00:00.000+10:30'
image: ../../assets/2024/03/logo_csharp.png
tags:
- .NET
---

_Part 2 in a series on new language features in C# 12._

![C# logo](../../assets/2024/03/logo_csharp.png)

## Collection expressions

You can now use square brackets `[]` to initialise a collection! Usually square brackets indicate an array, but the collection expression can be assigned to other collection types too.

You can use them to assign values to fields or in method bodies.

```csharp
private List<int> numbersList = [1, 2, 3, 4, 5];
```

Like primary constructors, I've also found these quite useful in new .NET 8 projects.

### Further reading

[https://learn.microsoft.com/dotnet/csharp/language-reference/operators/collection-expressions?WT.mc_id=DOP-MVP-5001655](https://learn.microsoft.com/dotnet/csharp/language-reference/operators/collection-expressions?WT.mc_id=DOP-MVP-5001655)

### Example source

[https://github.com/flcdrg/csharp-12/blob/main/02-collection-expressions/CollectionExpressions.cs](https://github.com/flcdrg/csharp-12/blob/main/02-collection-expressions/CollectionExpressions.cs)
