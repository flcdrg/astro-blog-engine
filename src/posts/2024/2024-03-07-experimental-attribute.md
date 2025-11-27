---
title: 'C# 12 features: ExperimentalAttribute'
date: '2024-03-07T07:00:00.000+10:30'
image: ../../assets/2024/03/logo_csharp.png
tags:
- .NET
---

_Part 7 in a series on new language features in C# 12._

![C# logo](../../assets/2024/03/logo_csharp.png)

## Experimental attribute

Mark a type, method, or assembly with the `ExperimentalAttribute` and the compiler will generate a warning. You will need to explicitly suppress this warning to consume the experimental code.

```csharp
[Experimental("DAVID01")]
public class ExperimentalClass
{
    public void Thing()
    {
        //
    }
}
```

In some ways, this feels to me like the opposite of the `ObsoleteAttribute`.

### Further reading

[https://learn.microsoft.com/dotnet/csharp/language-reference/attributes/general?WT.mc_id=DOP-MVP-5001655#experimental-attribute](https://learn.microsoft.com/dotnet/csharp/language-reference/attributes/general?WT.mc_id=DOP-MVP-5001655#experimental-attribute)

### Example source

[https://github.com/flcdrg/csharp-12/blob/main/07-experimental/ExperimentalClass.cs](https://github.com/flcdrg/csharp-12/blob/main/07-experimental/ExperimentalClass.cs)
