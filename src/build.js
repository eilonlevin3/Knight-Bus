// Which version of the app this is. Docs: docs/release-process.md
// This file is overwritten at deploy time by scripts/build-site.sh:
//   channel: 'main' (what users get) | 'debug' (test version) | 'local' (your computer)
//   commit:  the git commit the site was built from
// @req REQ-REL-1
export const build = { channel: 'local', commit: 'dev', builtAt: null };
