---
title: Azure Function posting an RSS feed to Mastodon
date: '2024-01-13T13:00:00.000+10:30'
image: ../../assets/2021/08/azure-function.png
tags:
- Azure
- Azure Functions
- .NET
---

Twitter (or 'X' as it seems to be called now), to my surprise, hasn't died yet. [I'm still there](https://twitter.com/DavidRGardiner), but I must say I'm enjoying the discussions over on Mastodon a lot more (follow me at [https://mastodon.online/@DavidRGardiner](https://mastodon.online/@DavidRGardiner)). But there are a few feeds that I follow on Twitter that I'd like to follow on Mastodon. So I wrote a little Azure Function to do that for me (and anyone else who is interested).

One that is relevant to living in South Australia, especially over the warmer months, given where I live is a bushfire-prone area, is keeping an eye on the updates from the [Country Fire Service](https://cfs.sa.gov.au/home/) (known locally as the CFS). They have a Twitter account, but not a Mastodon account. If only there was a way to get their updates on Mastodon!

![Example CFS Alert posted to Mastodon](../../assets/2024/01/cfs-alert.png)

As it turns out, the CFS [publish some RSS feeds](https://cfs.sa.gov.au/warnings-restrictions/warnings/rss-feeds/). My first attempt was to make use of a service like [Mastofeed](https://mastofeed.org), which in theory can take an RSS feed and post updates to Mastodon. But as I discovered, the RSS feed from the CFS has a few oddities that seem to prevent this from working correctly - it posted one update but then stopped. Here's an example of the RSS feed:

```xml
<?xml version='1.0' ?>
<rss version='2.0' xmlns:atom='http://www.w3.org/2005/Atom'>
  <channel>
    <atom:link href='https://data.eso.sa.gov.au/prod/cfs/criimson/cfs_current_incidents.xml' rel='self' type='application/rss+xml' />
    <ttl>15</ttl>
    <title>Country Fire Service - South Australia - Current Incidents</title>
    <link>https://www.cfs.sa.gov.au/incidents/</link>
    <description>Current Incidents</description>
    <item>
      <link>https://www.cfs.sa.gov.au/incidents/</link>
      <guid isPermaLink='false'>https://data.eso.sa.gov.au/prod/cfs/criimson/1567212.</guid>
      <title>TIERS ROAD, LENSWOOD (Tree Down)</title>
      <identifier>1567212</identifier>
      <description>First Reported: Saturday, 06 Jan 2024 15:41:00&lt;br&gt;Status: GOING&lt;br&gt;Region: 1</description>
      <pubDate>Sat, 06 Jan 2024 16:15:03 +1030</pubDate>
    </item>
```

There is the `identifier` element that is non-standard, but I suspect the main issue is the `guid` element. For some reason, the `isPermaLink` attribute is set to false. On the face of it, that looks like a mistake. That URI (which incorporates the identifier value) does appear to be unique. With `isPermaLink` set to false, it hints that the value can't be used as a unique identifier. I'm guessing because of that, Mastofeed had no way to distinguish posts in the RSS feed.

So we're out of luck using the simple option. My next thought was whether there was something that could transform/fix up the RSS on the fly - an 'XSLT proxy' if you like, but I've not found a free offering like that.

Maybe I can write some code to do the job instead. Hosting it in an Azure Function should work, and ideally would be free (or really cheap).

## An Azure Function

I ended up writing a relatively simple Azure Function in C# that polls the RSS feed every 15 minutes (as that's the value of the `ttl` element). It then posts any new items to Mastodon. Here's the code ([Link to GitHub repo](https://github.com/flcdrg/cfsalerts-mastodon/blob/be9f1ddde2e121e047d9d6ed45a141263d05db58/src/CfsAlerts/CfsFunction.cs)):

```csharp
    [Function(nameof(CheckAlerts))]
    public async Task<List<CfsFeedItem>> CheckAlerts([ActivityTrigger] List<CfsFeedItem> oldList)
    {
        var newList = new List<CfsFeedItem>();

        var response = string.Empty;
        try
        {
            using var httpClient = _httpClientFactory.CreateClient();

            response = await httpClient.GetStringAsync(
                "https://data.eso.sa.gov.au/prod/cfs/criimson/cfs_current_incidents.xml");

            var xml = XDocument.Parse(response);

            if (xml.Root.Element("channel") is null)
                throw new InvalidOperationException("No channel element found in feed");

            var xmlItems = xml.Root.Element("channel")?.Elements("item").ToList();

            if (xmlItems is not null)
                foreach (var item in xmlItems)
                {
                    var dateTime = DateTime.Parse(item.Element("pubDate").Value);

                    newList.Add(new CfsFeedItem(
                        item.Element("guid").Value,
                        item.Element("title").Value,
                        item.Element("description").Value,
                        item.Element("link").Value,
                        dateTime
                    ));
                }

            // Find items in newList that are not in oldList
            var newItems = newList.Except(oldList).ToList();

            if (newItems.Any())
            {
                var accessToken = _settings.Token;
                var client = new MastodonClient(_settings.Instance, accessToken);

                foreach (var item in newItems)
                {
                    var message = $"{item.Title}\n\n{item.Description.Replace("<br>", "\n")}\n{item.Link}";

                    _logger.LogInformation("Tooting: {item}", message);

#if RELEASE
                await client.PublishStatus(message, Visibility.Unlisted);
#endif
                }
            }
            else
            {
                _logger.LogInformation("No new items found");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Problems. Data: {data}", response);
        }

        return newList;
    }
```

We keep a copy of the previous list of items, and then compare it to the new list. If there are any new items, we post them to Mastodon. Because we need to remember the previous run items, we need to use [Durable Functions](https://docs.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-overview?tabs=csharp). This was my first time creating a Durable Function, so that also made it a good learning experience. The ['eternal orchestration' pattern](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-eternal-orchestrations?WT.mc_id=DOP-MVP-5001655) is used, where the orchestration function calls itself, passing in the new list of items. Here's the orchestration function code:

```csharp
    [Function(nameof(MonitorJobStatus))]
    public static async Task Run(
        [OrchestrationTrigger] TaskOrchestrationContext context, List<CfsFeedItem> lastValue)
    {
        var newValue = await context.CallActivityAsync<List<CfsFeedItem>>(nameof(CfsFunction.CheckAlerts), lastValue);

#if RELEASE
        // Orchestration sleeps until this time (TTL is 15 minutes in RSS)
        var nextCheck = context.CurrentUtcDateTime.AddMinutes(15);
#else
        var nextCheck = context.CurrentUtcDateTime.AddSeconds(20);
#endif

        await context.CreateTimer(nextCheck, CancellationToken.None);

        context.ContinueAsNew(newValue);
    }
```

The Durable Function infrastructure handles serialising and deserialising the list of items automatically. The Function takes a parameter that receives the list from the previous run. When the function completes, it returns the list that will be passed to the next run. The orchestration function passes in the list and sets things up to save the list so that it can be passed to the next run.

One thing about this pattern is you need some way of kickstarting the process. The way I chose was to add a HTTP trigger function that calls the orchestration function. The release pipeline makes a call to the HTTP trigger endpoint after it publishes the function.

## Durable + .NET 8 + isolated

The Durable Function targets .NET 8 and uses the isolated model. It was a little challenging figuring out how to get this combination to work, as most of the documentation is either for the in-process model or for earlier versions of .NET. Ensuring that the appropriate NuGet packages were being referenced was tricky, as there are often different packages to use depending on the model and version of .NET. I ended up using the following packages:

```xml
    <PackageReference Include="Mastonet" Version="2.3.1" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.20.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.DurableTask" Version="1.1.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http" Version="3.1.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Timer" Version="4.3.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.16.4" />
    <PackageReference Include="Microsoft.Extensions.Configuration.UserSecrets" Version="8.0.0" />

```

## Costs

To keep costs to a minimum, the Azure Function is running on a consumption plan. The intention is to keep it close to or under the [free threshold](https://azure.microsoft.com/en-au/pricing/details/functions/).

As it turns out, so far the Function is not costing very much at all. It's actually the Storage Account that is the most significant. AUD8.30 so far and the total forecast for the month will be AUD17. An Azure Function needs to be linked to a Storage Account. It would be interesting to see if there are any changes I could make to reduce the cost further.

![Azure cost summary](../../assets/2024/01/cfs-azure-costs.png)

To see the latest posts from the Azure Function, you can go to [https://mastodon.online/@CFSAlerts](https://mastodon.online/@CFSAlerts) (and if you're on Mastodon, feel free to follow the account!)

## Future enhancements

Apart from seeing if I can reduce the cost even more, the other thing that would be useful is to also track the daily fire bans. This data is [published as an XML file](https://data.eso.sa.gov.au/prod/cfs/criimson/fireDangerRating.xml), so parsing that once a day should be pretty straightforward.

You can find the full source code for the Azure Function in [this GitHub repo](https://github.com/flcdrg/cfsalerts-mastodon/).
