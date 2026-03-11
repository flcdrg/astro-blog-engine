---
title: Docker run from an Azure Pipeline Container Job with a volume mount
date: '2024-05-10T17:30:00.000+09:30'
image: ../../assets/2020/05/azure-pipelines-logo.png
tags:
- Azure DevOps
- Azure Pipelines
---

This caught me out today. I was trying to run a Docker container directly from a script task, where the pipeline job was already running in a container (as a [Container Job](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/container-phases?view=azure-devops&WT.mc_id=DOP-MVP-5001655)), similar to this:

```yaml
  - job: MyJob
    container:
      image: my-container-job-image:latest

    steps:
      - script: |
          docker run --mount type=bind,source="$(pwd)",target=/home/src --rm -w /home/src my-container:latest
```

The bit that was failing was the `--mount`, with the following error message:

```text
docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /__w/3/s.
```

Eventually, I realised the problem - By default, when a job is running as a Container Job, all the tasks are also running in the context of that container. So `$(pwd)` was resolving to `/__w/3/s`. That happens to be the default directory, and also where your source code is mapped to (via a volume mount that you can see by viewing the output of the "Initialize containers" step).

But when you invoke `docker run`, Docker doesn't try and run the new container inside the existing Container Job container, rather it will run alongside it! So any paths you pass to Docker need to be relative to the host machine, not relative to inside the container job.

In my case, the solution was to add a `target: host` property to the script task, so that the entire script is now run in the context of the host, rather than the container. eg.

```yaml
      - script: |
          docker run --mount type=bind,source="$(pwd)",target=/home/src --rm -w /home/src my-container:latest
        target: host
```

Now when the pipeline runs, `$(pwd)` will resolve to `/agent/_work/3/s` (which is the actual directory on the host machine), and the mount will work correctly!
