{
  lib,
  stdenvNoCC,
  fetchurl,
}:
let
  version = "0.1.15";
  targets = {
    aarch64-darwin = {
      triple = "aarch64-apple-darwin";
      hash = "sha256-L+IZY/q1m0WSiMTuXPyXlhzmntUvavZpqWWNo/bKL5o=";
    };
    x86_64-darwin = {
      triple = "x86_64-apple-darwin";
      hash = "sha256-UhyE74skIMMYbyP48O0SBLycqd54NK0gPccXPcbelZ8=";
    };
    aarch64-linux = {
      triple = "aarch64-unknown-linux-musl";
      hash = "sha256-xlTVTCREWTHCNZAOrw3CJrmcEgmaUdpsr1iq1zfzwD0=";
    };
    x86_64-linux = {
      triple = "x86_64-unknown-linux-musl";
      hash = "sha256-gcGXwKzNk0bOhyLq8MukChDjsWXO8zLXjPzYb8JcU6c=";
    };
  };
  system = stdenvNoCC.hostPlatform.system;
  target = targets.${system} or (throw "ratex-render has no release build for ${system}");
in
stdenvNoCC.mkDerivation {
  pname = "ratex-render";
  inherit version;

  src = fetchurl {
    url = "https://github.com/erweixin/RaTeX/releases/download/v${version}/ratex-cli-v${version}-${target.triple}.tar.gz";
    inherit (target) hash;
  };

  sourceRoot = "ratex-cli-v${version}-${target.triple}";
  dontConfigure = true;
  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 render $out/bin/ratex-render
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    printf 'x^2\n' | $out/bin/ratex-render --output-dir "$TMPDIR/check" | grep -q '^OK'
    test -s "$TMPDIR/check/0001.png"
  '';

  meta = {
    description = "RaTeX's PNG renderer for KaTeX math, as merman runs it";
    homepage = "https://github.com/erweixin/RaTeX";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = builtins.attrNames targets;
    mainProgram = "ratex-render";
  };
}
