---
title: Why is PowerShell not expanding variables for a command?
date: '2025-02-14T12:00:00.000+10:30'
image: ../../assets/2025/02/powershell-logo.png
imageAlt: PowerShell logo
tags:
- PowerShell
---

This had me perplexed. I have a PowerShell script that calls Docker and passes in some build arguments like this:

```powershell
docker build --secret id=npm,src=$($env:USERPROFILE)/.npmrc --progress=plain -t imagename .
```

But it was failing with this error:

```text
ERROR: failed to stat $($env:USERPROFILE)/.npmrc: CreateFile $($env:USERPROFILE)/.npmrc: The filename, directory name, or volume label syntax is incorrect.
```

It should be evaluating the `$($env:USERPROFILE)` expression to the current user's profile/home directory, but it isn't.

Is there some recent breaking change in how PowerShell evaluates arguments to a native command? I skimmed the release notes but nothing jumped out.

I know you can use the ["stop-parsing token" `--%`](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_parsing?view=powershell-7.5&WT.mc_id=DOP-MVP-5001655#the-stop-parsing-token) to stop PowerShell from interpreting subsequent text on the line as commands or expressions, but I wasn't using that.

In fact the whole [about_Parsing](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_parsing?view=powershell-7.5&WT.mc_id=DOP-MVP-5001655) documentation is a good read to understand the different modes and how PowerShell passes arguments to native and PowerShell commands. But I still couldn't figure it out.

So what's going on?

Another tool I find useful when trying to diagnose issues with passing arguments is [EchoArgs](https://community.chocolatey.org/packages/echoargs). It too reported the argument was not being evaluated.

But then I noticed something curious on the command line:

![Screenshot of echoargs command line with comma separating arguments in grey colour](../../assets/2025/02/echoargs-command-line.png)

That comma is being rendered in my command line in grey, but the rest of the arguments are white (with the exception of the variable expression). Could that be the problem?

Let's try enclosing the arguments in double quotes..

```powershell
docker build --secret "id=npm,src=$($env:USERPROFILE)/.npmrc" --progress=plain -t imagename .
```

Notice the colours on the command line - the comma is not different now:

![Screenshot of echo args command line, now with double quotes and the comma not in a different colour](../../assets/2025/02/echoargs-command-line2.png)

And the colouring on the command line also hints that it is not treating the comma as something special.

And now our Docker command works!
