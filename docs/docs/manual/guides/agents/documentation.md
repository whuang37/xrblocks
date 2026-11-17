---
title: Find documentation and public APIs
slug: /agents/documentation
---

# Find documentation and public APIs

Read the documentation for the package the application uses. Retrieve complete
example source when startup or dependency details are missing from a snippet.

## Read the source pages

Start with [SDK guides](/sdk), the [example catalog](/examples), and
[public API reference](/api). In a checkout, the public guides live under
`docs/docs/manual/`. Their Markdown and MDX files contain the page text and code;
MDX pages can also import preview components.

For remote access, open [the documentation source](https://github.com/google/xrblocks/tree/main/docs/docs/manual)
and select the file in the required branch or tag. GitHub's Raw action provides
its text. A remote client must use accessible URLs or an available checkout;
it cannot assume it can open a repository-relative filesystem path.

Follow an example's Source link for its complete project and sibling files.
Follow its Run link to launch the hosted application. Hosted examples can have
a different deployment revision from the installed package. Use a matching
local checkout when an exact match is required.

## Match the package

Inspect the application's lockfile and installed `xrblocks/package.json`.
For a release, use its packaged declarations and matching source tag. For a
repository build, use its actual commit. The package version alone does not
identify untagged source changes.

When documentation differs, prefer the installed public exports/declarations and
matching executable code over remembered APIs. A proposed interface in an issue
or research note is not the shipped contract.

## Verify a symbol

Search the [core reference](/api). In a checkout, search `src/xrblocks.ts` and
its exported modules. Check the signature, prerequisites, units, return value,
and ownership before using an operation. An internal source file or private
`build/internal/` chunk is not an application contract.

Use [dependencies](/integrations/dependencies) to resolve required packages.
Continue with [the verification workflow](/agents/workflow).
