# XR Blocks Documentation Site

Source code for https://xrblocks.github.io/docs/. \
This website is built using [Docusaurus](https://docusaurus.io/).

## Development

Start the development server for the documentation:

```bash
# In the xrblocks/docs/ directory
npm start
```

This serves the documentation site locally at `http://localhost:3000/` and
watches for changes to the documentation source files.

When viewing docs pages that embed templates or samples, **also** follow the
[development guide](../README.md#development-guide) in the root README to serve
the SDK on port 8080. Both servers can run simultaneously.

## Deployment

The documentation site is automatically deployed to https://xrblocks.github.io/docs/
whenever it is updated in the [google/xrblocks](https://github.com/google/xrblocks) repository.

## Public documentation content

The Manual sidebar is generated from `docs/manual/`. Its content is grouped into
Quickstarts, Guides, Examples, and Troubleshooting through `_category_.json`
metadata. The existing theme, top navigation, API sidebar, and template/sample
preview components provide the page layout.

Edit the page that owns a concept and link to it from related examples. Check
public names in `src/xrblocks.ts` and the relevant source before documenting an
API. Link prerequisites, expected results, failures, and cleanup where the task
needs them. Use “Examples” for complete applications.

Run `npm run build` from this directory after changes. Check missing source
links and code snippets against their executable projects as well as reviewing
the rendered documentation. Do not hand-edit generated API pages.
