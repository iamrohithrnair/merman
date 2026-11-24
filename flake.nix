{
  description = "merman: mermaid diagrams, tables and code drawn in color in Claude Code";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      browserFor =
        pkgs:
        if nixpkgs.lib.meta.availableOn pkgs.stdenv.hostPlatform pkgs.chromium then pkgs.chromium else null;
    in
    {
      packages = forAllSystems (
        pkgs:
        let
          mmdc = pkgs.callPackage ./nix/mmdc.nix { browser = browserFor pkgs; };
          ratex-render = pkgs.callPackage ./nix/ratex.nix { };
        in
        {
          inherit mmdc ratex-render;
          claude-plugin = pkgs.callPackage ./nix/plugin.nix {
            settings =
              nixpkgs.lib.optionalAttrs (browserFor pkgs != null) {
                mermaidImages = true;
                mmdcPath = nixpkgs.lib.getExe mmdc;
              }
              // {
                latex = true;
                ratexPath = nixpkgs.lib.getExe ratex-render;
              };
          };
          default = self.packages.${pkgs.stdenv.hostPlatform.system}.claude-plugin;
        }
      );

      homeModules.default = ./nix/hm-module.nix;
      homeManagerModules = self.homeModules;

      checks = forAllSystems (pkgs: {
        inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) claude-plugin ratex-render;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
