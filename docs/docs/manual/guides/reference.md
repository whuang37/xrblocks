---
title: API reference
slug: /reference
sidebar_position: 23
---

# API reference

Use the reference for exact public imports, signatures, types, options, units,
and return values. Use [SDK guides](/sdk) for setup and ownership, and
[examples](/examples) for complete applications.

## Public entry points

- [Core SDK reference](/api): symbols re-exported by `src/xrblocks.ts`.
- [Dependencies](/integrations/dependencies): required packages and module loading.

Import core symbols from `xrblocks`. Import an addon through its documented
`xrblocks/addons/...` entry. An internal source file, private render mesh, or
private build chunk is not an application contract.

## Find a contract

Start with [Options](/api/classes/Options) for configuration, [Script](/api/classes/Script) for
lifecycle/hooks, [UICard](/api/classes/UICard) for world-space UI, or
[Interaction](/api/classes/Interaction) for event routing.

Reference is generated from the public source used for the documentation build.
Missing source comments are documentation gaps, not permission to guess a
signature. Check the installed package's exports/declarations when its version
differs from this site; see [version matching](/agents/documentation#match-the-package).
