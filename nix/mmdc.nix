{
  lib,
  stdenv,
  mermaid-cli,
  browser ? null,
}:
if browser == null || !(lib.meta.availableOn stdenv.hostPlatform browser) then
  mermaid-cli
else
  mermaid-cli.override { chromium = browser; }
