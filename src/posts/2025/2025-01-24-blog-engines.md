---
title: Blog engine thoughts
date: '2025-01-24T16:00:00.000+10:30'
tags:
- Blogging
---

Next month will mark the 20th year that I've been blogging. I started off in 2005 using Blogger, then in [2019 I migrated to Jekyll on GitHub Pages](/2019/06/migrating-from-blogger).
I gained a lot more control over how how my blog is rendered to HTML, but one thing has always bothered me - I really don't understand [Jekyll](https://jekyllrb.com/)/Liquid/Ruby as well as I'd like, to be able to make customisations confidently.

Adopting a blog engine that uses a programming language that I have more experience with would go a long way to solving that. And that effectively narrows things down to C# and JavaScript/TypeScript.

The other constraint is that I'm really happy with having a static site. I don't want to have a database or any other backend resources - just generate the HTML pages that's it.

So looking around, the one .NET static engine I've encountered is Dave Glick's [Statiq](https://www.statiq.dev/). This looked quite promising, and I did create a feature branch to try it out with my content.
And that's where I hit some performance issues that seemed to relate to the Statiq.Web extension and the default blog template. As I already mentioned, I've been blogging for a while, and so when I count them all up, so far I have accumulated over 1100 posts!
When I ran that feature branch on my full set of posts, it took 30 minutes on my i9 laptop (or almost an hour for the GitHub Action) to build the site.
[I did raise this](https://github.com/orgs/statiqdev/discussions/137) at the time, but it hasn't been resolved, and development on Statiq seems to have largely stopped.

On the JavaScript/TypeScript side, I had noticed a lot of positive comments about [Eleventy](https://www.11ty.dev/).
Again, I spent a bit of time working on a feature branch to see how that could work, but I have to be honest I found the documentation a bit confusing.
I do really prefer using TypeScript if possibly, and the support for that was not really first class.

Eleventy v3 was released late last year after I'd done my test run, so it could be worth revisiting.

Lastly, I wondered whether it was worth trying to do it all myself. I started to prototype out what this might look like at [https://github.com/flcdrg/DaydreamEngine](https://github.com/flcdrg/DaydreamEngine). I could potentially use ASP.NET Core's Razor components for managing layout with the [ability to render them even when you're not running a web server](https://learn.microsoft.com/aspnet/core/blazor/components/render-components-outside-of-aspnetcore?view=aspnetcore-8.0&WT.mc_id=DOP-MVP-5001655).

## Blog structure

One of the challenges I hit was thinking about the structure that is being generated, and trying to see how that would fit into the way the above blog engines seem to work.

### Blogger

The old Blogger structure looked like this (Screenshot from [Internet Archive's Wayback Machine](https://web.archive.org/web/20170219235104/https://david.gardiner.net.au/)):

![Screenshot of blog from 2017](../../assets/2025/01/blog-screenshot-2017.jpg)

Home page

- Title banner
- Last 2/3 posts in full
- Right hand sidebar
  - Links to other pages
  - Links to other blogs
  - Labels (categories)
  - List of years/month/posts
- Link to older posts (search)
- Footer

Individual posts are referenced using the following address format:

```text
/2018/08/create-temporary-file-with-custom.html
```

### Jekyll

![Screenshot of current Jekyll-based blog](../../assets/2025/01/blog-screenshot-2025.jpg)

Home page

- Title banner
- Last 3 posts in full
- No right hand sidebar
- Link to older posts (/page2,/page3,..page100)
- Footer

Individual posts use same address format as Blogger.

### Future

Closer to the Blogger layout.
Home page

- last 3 posts in full
- Right hand sidebar
  - Links to other pages
  - List of categories
  - Search facility
- Link to history
- Footer

I see some blogs that just put a summary of each post on the home page, requiring you to click on the link to read the full article.

The problem with the /page2,/page3 approach is that every time you add a new post, all the pages need to be rewritten. It inserts the new post at the front. It's the opposite of a traditional book or journal, where you would append new content at the end.
I think this also means the /page2,/page3 confuse search engines a bit as the content keeps changing.

I think you still do need some kind of index/navigation page. Maybe having a year-based one would be more useful. I don't post enough that I think you need to break down a year into separate month pages.

So that's where I'm at for now. Another look at Eleventy v3, otherwise let's see what else I can implement in [https://github.com/flcdrg/DaydreamEngine](https://github.com/flcdrg/DaydreamEngine)
