{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.merman;
  images = cfg.mermaidImages;
  hasBrowser = images.browser != null && lib.meta.availableOn pkgs.stdenv.hostPlatform images.browser;
  baked =
    lib.optionalAttrs images.enable {
      mermaidImages = true;
      mmdcPath = lib.getExe images.package;
    }
    // lib.optionalAttrs cfg.latex.enable {
      latex = true;
      ratexPath = lib.getExe cfg.latex.package;
    }
    // cfg.settings;
  plugin = pkgs.callPackage ./plugin.nix { settings = baked; };
in
{
  options.programs.merman = {
    enable = lib.mkEnableOption "merman, which redraws Claude Code replies with themeable colors";

    settings = lib.mkOption {
      type =
        with lib.types;
        attrsOf (oneOf [
          bool
          str
          int
        ]);
      default = { };
      example = lib.literalExpression ''
        {
          theme = "catppuccin-mocha";
          clock = "24h";
          clockTimeZone = "America/Los_Angeles";
        }
      '';
      description = ''
        merman options, by their key in `userConfig` of `.claude-plugin/plugin.json`.
        They become the options' defaults, so a value you save with `/config` or
        `/merman setup` still wins. The build fails on an unknown key, a value of the
        wrong type, or a value outside an option's choices.
      '';
    };

    mermaidImages = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Draw mermaid diagrams as images in kitty and Ghostty with mermaid-cli, which
          this module installs with a headless browser and points merman at.
        '';
      };

      browser = lib.mkOption {
        type = lib.types.nullOr lib.types.package;
        default =
          if lib.meta.availableOn pkgs.stdenv.hostPlatform pkgs.chromium then pkgs.chromium else null;
        defaultText = lib.literalExpression "pkgs.chromium on Linux, null elsewhere";
        example = lib.literalExpression "pkgs.google-chrome";
        description = ''
          The browser mermaid-cli renders with. nixpkgs builds Chromium only for Linux;
          on macOS set `pkgs.google-chrome`, which needs `allowUnfree`.
        '';
      };

      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.callPackage ./mmdc.nix { inherit (images) browser; };
        defaultText = lib.literalExpression "pkgs.mermaid-cli using programs.merman.mermaidImages.browser";
        description = "The mermaid-cli package whose `mmdc` merman runs.";
      };
    };

    latex = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Draw `$$` and ```` ```math ```` formulas as images in kitty and Ghostty with RaTeX's
          renderer, which this module installs from RaTeX's release binaries and points
          merman at.
        '';
      };

      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.callPackage ./ratex.nix { };
        defaultText = lib.literalExpression "RaTeX's release ratex-render";
        description = "The package whose `ratex-render` merman runs.";
      };
    };

    tmuxImages = lib.mkOption {
      type = lib.types.bool;
      default = config.programs.tmux.enable && (images.enable || cfg.latex.enable);
      defaultText = lib.literalExpression "config.programs.tmux.enable && (mermaidImages.enable || latex.enable)";
      description = ''
        Let images draw inside tmux. merman and Claude Code skip images when `TMUX` is
        set, so this adds `allow-passthrough on` and sets
        `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` in tmux's global environment, which new
        panes inherit. `home.sessionVariables` cannot do it: a running tmux server
        keeps `__HM_SESS_VARS_SOURCED`, so its new panes skip the session variables.
        Passthrough lets programs in a pane write escape sequences to the outer
        terminal. Panes already open keep their environment, so start Claude Code
        in a new pane.
      '';
    };

    configDir = lib.mkOption {
      type = lib.types.str;
      default = ".claude";
      description = "Claude Code's config directory, relative to the home directory.";
    };

    plugin = lib.mkOption {
      type = lib.types.package;
      readOnly = true;
      default = plugin;
      description = "The plugin folder this module links, with `settings` baked in.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !images.enable || hasBrowser;
        message = ''
          programs.merman.mermaidImages needs a browser for mermaid-cli, and nixpkgs has no
          Chromium for ${pkgs.stdenv.hostPlatform.system}. Set
          programs.merman.mermaidImages.browser = pkgs.google-chrome (needs allowUnfree),
          or set programs.merman.mermaidImages.enable = false.
        '';
      }
    ];

    home.file."${cfg.configDir}/skills/merman".source = plugin;

    programs.tmux.extraConfig = lib.mkIf cfg.tmuxImages ''
      set -g allow-passthrough on
      set-environment -g CLAUDE_CODE_FORCE_TERMINAL_IMAGES 1
    '';
  };
}
