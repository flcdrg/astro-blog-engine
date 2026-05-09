---
title: Passing arguments to npm in PowerShell
date: '2025-01-31T12:00:00.000+10:30'
image: ../../assets/2025/01/npm.png
imageAlt: "NPM logo"
description: 'How to pass arguments to npm scripts from PowerShell without the shell swallowing them.'
tags:
- PowerShell
---

![npm logo](../../assets/2025/01/npm.png)

This just caught me out. I was following [the tutorial for the Astro web framework](https://docs.astro.build/en/tutorial/1-setup/2/) and it contains instructions to run this command:

```bash
npm create astro@latest -- --template minimal
```

The tutorial suggested you would then be prompted to enter a target directory.

Except I wasn't - I was seeing an interactive menu asking me to choose a template. This seemed weird as it kind of looks like the arguments above are telling it which template to use.

After a bit of experimenting I narrowed down the problem to running the command from PowerShell! (The command works fine in Bash or CMD). There's something in that line that PowerShell must be interpreting rather than just passing through to npm.

The solution that worked for me was to escape the dash. eg.

```powershell
npm create astro@latest `-- --template minimal
```

With that, npm seems to see the correct arguments and runs as per the tutorial instructions.
