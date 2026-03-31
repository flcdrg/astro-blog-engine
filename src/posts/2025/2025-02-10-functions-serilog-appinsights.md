---
title: .NET Azure Functions, Isolated worker model, Serilog to App Insights
date: '2025-02-10T08:00:00.000+10:30'
image: ../../assets/2025/02/serilog.png
tags:
- .NET
- Azure Functions
---

There's already some good resources online about configuring [.NET Azure Functions](https://learn.microsoft.com/azure/azure-functions/create-first-function-cli-csharp?WT.mc_id=DOP-MVP-5001655) with [Serilog](https://serilog.net/). For example, Shazni gives a [good introduction to Serilog and then shows how to configure for in-process and isolated Azure Functions](https://medium.com/ascentic-technology/a-comprehensive-guide-to-configuring-logging-with-serilog-and-azure-app-insights-in-net-f6e4bda69e76), and Simon shows [how to use Serilog with Azure Functions in isolated worker model](https://simonholman.dev/blog/configure-serilog-for-logging-in-azure-functions), but neither cover using App Insights.

It's important to note that the [in-process model goes out of support (along with .NET 8) in November 2026](https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model?WT.mc_id=DOP-MVP-5001655). Going forward, only the isolated worker model is supported by future versions of .NET (starting with .NET 9)

![Serilog logo](../../assets/2025/02/serilog.png)

The Serilog Sink package for logging data to Application Insights is [Serilog.Extensions.AppInsights](https://www.nuget.org/packages/Serilog.Sinks.ApplicationInsights/), and it has some useful code samples [in the README](https://github.com/serilog-contrib/serilog-sinks-applicationinsights), but they also lack mentioning the differences for isolated worker model.

So my goal here is to demonstrate the following combination:

- A .NET Azure Function
- That is using isolated worker mode
- That logs to Azure App Insights
- Uses Serilog for structured logging
- Uses the Serilog 'bootstrapper' pattern to capture any errors during startup/configuration

Note: There are full working samples for this post in [https://github.com/flcdrg/azure-function-dotnet-isolated-logging](https://github.com/flcdrg/azure-function-dotnet-isolated-logging).

Our starting point is an Azure Function that has Application Insights enabled. We uncommented to the two lines in Program.cs and the two .csproj file from the default Functions project template.

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;

var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices(services => {
        services.AddApplicationInsightsTelemetryWorkerService();
        services.ConfigureFunctionsApplicationInsights();
    })
    .Build();

host.Run();
```

One of the challenges with using the App Insights Serilog Sink, is that it needs to be configured with an existing `TelemetryConfiguration`. The old way of doing this was to reference [`TelemetryConfiguration.Active`](https://learn.microsoft.com/dotnet/api/microsoft.applicationinsights.extensibility.telemetryconfiguration.active?view=azure-dotnet&WT.mc_id=DOP-MVP-5001655), however using this property has been discouraged in .NET Core (aka modern .NET).

Instead you're encouraged to retrieve a valid `TelemetryConfiguration` instance from the service provider, like this:

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.ApplicationInsights(
        serviceProvider.GetRequiredService<TelemetryConfiguration>(),
    TelemetryConverter.Traces)
    .CreateLogger();
```

Except we have a problem. How can we reference the service provider? We need to move this under the `HostBuilder`, so we have access to a service provider.

There's a couple of ways to do this. Traditionally we would use `UseSerilog` to register Serilog similar to this:

```csharp
    var build = Host.CreateDefaultBuilder(args)
        .UseSerilog((_, services, loggerConfiguration) => loggerConfiguration
            .Enrich.FromLogContext()
            .Enrich.WithProperty("ExtraInfo", "FuncWithSerilog")

            .WriteTo.ApplicationInsights(
                services.GetRequiredService<TelemetryConfiguration>(),
                TelemetryConverter.Traces))
```

But [as of relatively recently](https://nblumhardt.com/2024/04/serilog-net8-0-minimal/#comment-6496448401), you can now also use `AddSerilog`, as it turns out under the covers, `UseSerilog` just calls `AddSerilog`.

So this is the equivalent:

```csharp
builder.Services
    .AddSerilog((serviceProvider, loggerConfiguration) =>
    {
        loggerConfiguration
            .Enrich.FromLogContext()
            .Enrich.WithProperty("ExtraInfo", "FuncWithSerilog")

            .WriteTo.ApplicationInsights(
                serviceProvider.GetRequiredService<TelemetryConfiguration>(),
                TelemetryConverter.Traces);
    })
```

There's also the 'bootstrap logging' pattern that was [first outlined here](https://nblumhardt.com/2020/10/bootstrap-logger/).

This can be useful if you want to log any configuration errors at start up. The only issue here is it will be tricky to log those into App Insights as you won't have the main Serilog configuration (where you wire up App Insights integration) completed yet. You could log to another sink ([Console](https://github.com/serilog/serilog-sinks-console), or [Debug](https://github.com/serilog/serilog-sinks-debug) if you're running locally).

Here's an example that includes bootstrap logging.

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.ApplicationInsights.Extensibility;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.Debug()
    .CreateBootstrapLogger();

try
{
    Log.Warning("Starting up.."); // Only logged to console

    var build = Host.CreateDefaultBuilder(args)
        .UseSerilog((_, services, loggerConfiguration) => loggerConfiguration
            .Enrich.FromLogContext()
            .Enrich.WithProperty("ExtraInfo", "FuncWithSerilog")

            .WriteTo.ApplicationInsights(
                services.GetRequiredService<TelemetryConfiguration>(),
                TelemetryConverter.Traces))

        .ConfigureFunctionsWebApplication()

        .ConfigureServices(services => {
            services.AddApplicationInsightsTelemetryWorkerService();
            services.ConfigureFunctionsApplicationInsights();
        })
        .ConfigureLogging(logging =>
        {
            // Remove the default Application Insights logger provider so that Information logs are sent
            // https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide?tabs=hostbuilder%2Clinux&WT.mc_id=DOP-MVP-5001655#managing-log-levels
            logging.Services.Configure<LoggerFilterOptions>(options =>
            {
                LoggerFilterRule? defaultRule = options.Rules.FirstOrDefault(rule => rule.ProviderName
                    == "Microsoft.Extensions.Logging.ApplicationInsights.ApplicationInsightsLoggerProvider");
                if (defaultRule is not null)
                {
                    options.Rules.Remove(defaultRule);
                }
            });
        })

        .Build();

    build.Run();
    Log.Warning("After run");
}
catch (Exception ex)
{
    Log.Fatal(ex, "An unhandled exception occurred during bootstrapping");
}
finally
{
    Log.Warning("Exiting application");
    Log.CloseAndFlush();
}
```

In my experimenting with this, when the Function is closed normally (eg. by being requested to stop in the Azure Portal / or pressing Ctrl-C in the console window when running locally) I was not able to get any logging working in the `finally` block. I think by then it's pretty much game over and the Function Host is keen to wrap things up.

But what if the Function is running in Azure? The Debug or Console sinks won't be much use there. In ApplicationInsights sink docs, there's a section on [how to flush messages manually](https://github.com/serilog-contrib/serilog-sinks-applicationinsights#how-when-and-why-to-flush-messages-manually). The code sample shows creating a new instance of `TelemetryClient` so that you *can* use the ApplicationInsights sink in the bootstrap logger.

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.Debug()
    .WriteTo.ApplicationInsights(new TelemetryClient(new TelemetryConfiguration()), new TraceTelemetryConverter())
    .CreateBootstrapLogger();
```

If I simulate a configuration error by throwing an exception inside the `ConfigureServices` call, then you do get data sent to App Insights. eg.

```json
{
    "name": "AppExceptions",
    "time": "2025-02-08T06:32:25.4548247Z",
    "tags": {
        "ai.cloud.roleInstance": "Delphinium",
        "ai.internal.sdkVersion": "dotnetc:2.22.0-997"
    },
    "data": {
        "baseType": "ExceptionData",
        "baseData": {
            "ver": 2,
            "exceptions": [
                {
                    "id": 59941933,
                    "outerId": 0,
                    "typeName": "System.InvalidOperationException",
                    "message": "This is a test exception",
                    "hasFullStack": true,
                    "parsedStack": [
                        {
                            "level": 0,
                            "method": "Program+<>c.<<Main>$>b__0_1",
                            "assembly": "FuncWithSerilog, Version=1.2.6.0, Culture=neutral, PublicKeyToken=null",
                            "fileName": "D:\\git\\azure-function-dotnet-isolated-logging\\net9\\FuncWithSerilog\\Program.cs",
                            "line": 36
                        },
                        {
                            "level": 1,
                            "method": "Microsoft.Extensions.Hosting.HostBuilder.InitializeServiceProvider",
                            "assembly": "Microsoft.Extensions.Hosting, Version=9.0.0.0, Culture=neutral, PublicKeyToken=adb9793829ddae60",
                            "line": 0
                        },
                        {
                            "level": 2,
                            "method": "Microsoft.Extensions.Hosting.HostBuilder.Build",
                            "assembly": "Microsoft.Extensions.Hosting, Version=9.0.0.0, Culture=neutral, PublicKeyToken=adb9793829ddae60",
                            "line": 0
                        },
                        {
                            "level": 3,
                            "method": "Program.<Main>$",
                            "assembly": "FuncWithSerilog, Version=1.2.6.0, Culture=neutral, PublicKeyToken=null",
                            "fileName": "D:\\git\\azure-function-dotnet-isolated-logging\\net9\\FuncWithSerilog\\Program.cs",
                            "line": 21
                        }
                    ]
                }
            ],
            "severityLevel": "Critical",
            "properties": {
                "MessageTemplate": "An unhandled exception occurred during bootstrapping"
            }
        }
    }
}
```

So there you go!

And this is all well and good, but it's important to mention that Microsoft are suggesting for new codebases [use OpenTelemetry instead of App Insights](https://learn.microsoft.com/azure/azure-monitor/app/worker-service?WT.mc_id=DOP-MVP-5001655)! I'll have to check out how that works soon.
