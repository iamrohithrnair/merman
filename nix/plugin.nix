{
  lib,
  runCommand,
  jq,
  settings ? { },
}:
let
  manifest = lib.importJSON ../.claude-plugin/plugin.json;
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../.claude-plugin/plugin.json
      ../hooks
      ../types
      ../LICENSE
    ];
  };
in
runCommand "merman-claude-plugin-${manifest.version}"
  {
    nativeBuildInputs = [ jq ];
    settingsJson = builtins.toJSON settings;
    passAsFile = [ "settingsJson" ];
    meta = {
      description = manifest.description;
      license = lib.licenses.mit;
    };
  }
  ''
    cp -r ${src} $out
    chmod -R u+w $out
    jq --slurpfile set "$settingsJsonPath" '
      $set[0] as $s
      | reduce ($s | keys[]) as $k (.;
          (.userConfig[$k] // error("merman has no option \($k)")) as $o
          | ($s[$k] | type) as $t
          | if $t != $o.type then error("merman option \($k) is a \($o.type), got a \($t)")
            elif ($o.options // null) != null and ($o.options | index($s[$k])) == null then error("merman option \($k) is one of \($o.options | join(", ")), got \($s[$k])")
            else .userConfig[$k].default = $s[$k] end)
    ' ${src}/.claude-plugin/plugin.json > $out/.claude-plugin/plugin.json
  ''
