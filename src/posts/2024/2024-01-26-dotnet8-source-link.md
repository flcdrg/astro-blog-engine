---
title: Source Link improvements in .NET 8 SDK
date: '2024-01-26T17:30:00.000+10:30'
image: ../../assets/2024/01/dotnet-logo.png
tags:
- .NET
---

One enhancement included in the .NET 8 SDK you might have overlooked is that if you're using GitHub, GitHub Enterprise, Azure Repos, GitLab 12.0+, or Bitbucket 4.7+ then you no longer need to add a package reference to the respective `Microsoft.SourceLink.*` NuGet packages to get source link support.

![.NET Logo](../../assets/2024/01/dotnet-logo.png)

Find out more about Source Link in the [NuGet documentation](https://learn.microsoft.com/en-us/dotnet/standard/library-guidance/sourcelink?WT.mc_id=DOP-MVP-5001655)

If you're using a tool like Dependabot to keep your NuGet packages up to date, you might see a pull request with a title similar to this:

> Bump Microsoft.SourceLink.GitHub from 1.1.1 to 8.0.0

That could be a hint that if you ensure .NET 8 SDK is being used to build the project then you can *remove* the `Microsoft.SourceLink.GitHub` package reference, rather than just accepting the pull request. One less package to maintain, but still the same debugging experience for users of your package.

Check out the [README in the Source Link repository on GitHub](https://github.com/dotnet/sourcelink#using-source-link-in-net-projects) for more information.
