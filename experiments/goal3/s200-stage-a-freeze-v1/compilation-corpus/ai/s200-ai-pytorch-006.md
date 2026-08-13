---
sourceId: s200-ai-pytorch-006
title: 'Hacker News thread: PyTorch 2.0 (item 35174612)'
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: U-experience
platform: hackernews
author: DreamFlasher (submitter) + multiple commenters
canonicalUrl: https://news.ycombinator.com/item?id=35174612
publishedAt: '2023-03-15T20:57:23Z'
capturedAt: '2026-08-10T12:35:00+08:00'
versionRef: 'null'
mediaType: thread
language: en
usage: internal-only
accessStatus: partial
evaluatorRawSnapshotHash: sha256:5e0057ea707368ba2676f92afdf7523646b0fd2ea954503a304542f9f30139f1
evaluatorNormalizedSnapshotHash: sha256:5e0057ea707368ba2676f92afdf7523646b0fd2ea954503a304542f9f30139f1
evaluatorUpstreamArtifactHash: sha256:caf37bbe88cae71d81321221c9bf28daeede469dde64904200f491db3199ad06
---

# Hacker News thread: PyTorch 2.0 (item 35174612)

## Source Snapshot

### Story

> Title: PyTorch 2.0
> Points: 462
> URL: https://pytorch.org/blog/pytorch-2.0-release/
> Created: 2023-03-15T20:57:23Z

### Selected comments (verbatim)

**fpgaminer** (2023-03-15T22:49:01Z):

> The thing I'm looking forward to most is having Flash Attention built-in. Right now you have to use xformers or similar, but that dependency has been a nightmare to use, from breaking, to requiring specific concoctions of installing dependencies or else conda will barf, to being impossible to pin because I have to use -dev releases which they constantly drop from the repositories.
>
> PyTorch 2.0 comes with a few different efficient transformer implementations built-in. And unlike 1.13, they work during training and don't require specific configurations. Seemed to work just fine during my pre-release testing. Also, having it built into PyTorch might mean more pressure to keep it optimized. As-is xformers targets A100 primarily, with other archs as an afterthought.
>
> And, as promised, `torch.compile` worked out of the box, providing IIRC a nice ~20% speed up on a ViT without any other tuning.
>
> I did have to do some dependency fiddling on the pre-release version. Been looking forward to the "stable" release before using it more extensively.
>
> Anyone else seeing nice boosts from `torch.compile`?

**singularity2001** (2023-03-16T04:42:41Z):

> 100% backward compatible
>
> That's (for me) the biggest reason why tensor flow fell out of flavor: the API broke too often (not just between tf 1 and 2)

**lucasap** (2023-03-16T08:15:27Z):

> If anyone can edit it, I found a typo:
> > Python 1.8 (deprecating Python 1.7)
> > Deprecation of Cuda 11.6 and Python 1.7 support for PyTorch 2.0
>
> It is clearly supposed to be python 3.8 and 3.7 respectively.

**brucethemoose2** (2023-03-15T21:09:23Z):

> I'm hoping torch.compile is a gateway to "easy" non-Nvidia accelerator support in PyTorch.
>
> Also, I have been using torch.compile for the Stable Diffusion unet/vae since February, to good effect. I'm guessing similar optimizations will pop up for LLaMA.

**xformers** (2023-03-16T22:18:03Z):

> I work on xFormers and we definitely appreciate the candid feedback:
> - We partnered with our PyTorch colleagues and some of the PyTorch 2.0 kernels for efficient attention actually originated from xFormers, so glad to read that having this now built-in into PyTorch is something users are really eager to use.
> - While xFormers was originally targeting a pure researcher audience, we were aware of the installation problems: we started end of last year gradually making it easier to setup and use the library (both internally and externally). We have recently introduced non-dev conda packages, pip wheels and are also trying to release more often,
