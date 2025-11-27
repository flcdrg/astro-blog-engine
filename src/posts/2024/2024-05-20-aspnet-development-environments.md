---
title: ASP.NET Core 'Development' Environment confusion
date: '2024-05-20T07:00:00.000+09:30'
image: ../../assets/2024/01/dotnet-logo.png
tags:
- .NET
---

ASP.NET Core has a useful feature for loading [different configuration settings depending on which environment](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/environments?view=aspnetcore-8.0&WT.mc_id=DOP-MVP-5001655) you're running in.

One question that is worth considering though: When it refers to a 'Development' configuration, do you understand that is for your local development/debugging experience, or is it for some non-production deployment environment (Azure, AWS, or even specifically dedicated machines)?

If you're not sure, or if there are differing opinions within your team then things can get confusing quickly!

One example to consider is connection strings to databases or blob storage.

- When developing locally these might resolve to localhost where you have SQL Server installed or a local Docker container running a storage emulator.
- When running in a deployment environment, they would point to existing resources. In Azure, they might be Azure SQL databases or Azure Storage accounts.

The [Environment class](https://learn.microsoft.com/dotnet/api/microsoft.extensions.hosting.environments?view=net-8.0&WT.mc_id=DOP-MVP-5001655) defines three pre-defined fields - Development, Production and Staging. There are also [three related extension methods](https://learn.microsoft.com/dotnet/api/microsoft.aspnetcore.hosting.hostingenvironmentextensions?view=aspnetcore-8.0&WT.mc_id=DOP-MVP-5001655) to test if the current environment is one of these - IsDevelopment, IsProduction, and isStaging. These are the three environment names provided in the box, but you are free to use other names too.

It's also quite common (even in Microsoft samples) to see code like this:

```csharp
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
```

Almost always these examples are for code that should only be executed in the local development environment - for example when you're debugging the application.

## So how do we avoid this confusion between local development and a development deployment environment?

### Define a custom environment name for local development

You might settle on something like 'localdev' or 'dev' and update all your `launchSettings.json` files to use that (if you use Visual Studio).

The risk with this approach is if you ever have code that uses the `Environment.IsDevelopment()` conditional, that will now return false. If you had code that should only run when you're running/debugging locally you'll need to use a different comparison. Also, watch out if you're using 3rd party libraries that also include similar conditional logic and are making assumptions about what `IsDevelopment()` means.

### Don't use different environments for configuration

Avoids the problem entirely, but you might discover you're missing out on being able to customise your local development experience.

### Only use 'Development' for local development

This feels the safest to me. The default when you create a new ASP.NET project is that the `launchSettings.json` file sets `ASPNETCORE_ENVIRONMENT` equal to 'Development' so you won't need to change that.

If there is a 'dev' deployment environment, you could create an `appsettings.dev.json` to manage environment-specific configuration.

Another (and possibly better) option is to manage environment-specific configuration via Infrastructure as Code. Bicep, Terraform, or similar, or in YAML or Sealed Secrets for Kubernetes. All of these result in environment variables being created that are visible by the ASP.NET application. Usefully, by default, the ASP.NET configuration builder loads environment variables after any `.json` files, and the rule is that the last loaded wins. So anything set via these methods will override any configuration in the `appsetting.json` file.

My personal preference is to regard any instance of the application running in an environment outside of your local machine as 'production', such that if you do have conditional code using `Environment.IsProduction()` that it will behave the same across all remote environments. My thinking here is unless it can't be avoided, you don't want to suddenly exercise a different code path in your 'production' environment to what you've been testing in your 'test', 'qa', 'staging' or even the shared 'development' environment.

You will still have different configuration values for each of these environments. But reducing or eliminating conditional logic differences across these should improve reliability and consistency, and give you the confidence that your production environment will behave the same as your non-production environments did.
