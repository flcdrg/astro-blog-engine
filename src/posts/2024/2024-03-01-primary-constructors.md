---
title: 'C# 12 features: Primary constructors'
date: '2024-03-01T07:00:00.000+10:30'
image: ../../assets/2024/03/logo_csharp.png
tags:
- .NET
---

Last month, we had a [".NET 8 Lightning talks" theme for the Adelaide .NET User Group](https://www.meetup.com/adelaide-dotnet/events/298685906/). John covered Blazor, Ryan summarised a bunch of new core library features, and I focused on the 8 new language features added in C# 12. What a great idea for a nice, short blog series!

![C# logo](../../assets/2024/03/logo_csharp.png)

## Primary constructors

C# has had primary constructors for records, but now we can use them for classes and structs!

The parameters can be used anywhere within the class - methods, local functions as well as initialising fields and properties.

A primary constructor guarantees that the named parameters have been supplied when an instance is created. You can optionally add other conventional constructors, but they must all call back to the primary constructor using the `this(...)` syntax.

```csharp
public class PrimaryConstructorClass(string name)
{
    private string Name { get; init; } = name;

    private string Name2 => name;

    public void Thing()
    {
        Console.WriteLine(name);
    }
}
```

I've made regular use of these whenever I've been working on a .NET 8 project. I've found them very useful.

### Further reading

[https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/instance-constructors?WT.mc_id=DOP-MVP-5001655#primary-constructors](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/instance-constructors?WT.mc_id=DOP-MVP-5001655#primary-constructors)

### Example source

[https://github.com/flcdrg/csharp-12/tree/main/01-primary-constructors](https://github.com/flcdrg/csharp-12/tree/main/01-primary-constructors)
