---
title: 'C# 12 features: Default lambda parameters'
date: '2024-03-04T07:00:00.000+10:30'
image: ../../assets/2024/03/logo_csharp.png
tags:
- .NET
---

_Part 4 in a series on new language features in C# 12._

![C# logo](../../assets/2024/03/logo_csharp.png)

## Default lambda parameters

A pretty simple addition to the language - you can now provide default values for lambda expression parameters.

```csharp
var IncrementBy = (int source, int increment = 1) => source + increment;
```

In the lambda defined above, if you don't supply the `increment` parameter, it defaults to `1`.

Again, interesting, but I've not come across a need to use this yet.

### Further reading

[https://learn.microsoft.com/dotnet/csharp/language-reference/operators/lambda-expressions?WT.mc_id=DOP-MVP-5001655#input-parameters-of-a-lambda-expression](https://learn.microsoft.com/dotnet/csharp/language-reference/operators/lambda-expressions?WT.mc_id=DOP-MVP-5001655#input-parameters-of-a-lambda-expression)

### Example source

[https://github.com/flcdrg/csharp-12/blob/main/04-optional-params-lambda/LambdaParameters.cs](https://github.com/flcdrg/csharp-12/blob/main/04-optional-params-lambda/LambdaParameters.cs)
