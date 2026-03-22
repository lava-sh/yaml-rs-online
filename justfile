set windows-shell := ["pwsh.exe", "-NoLogo", "-Command"]

config_file := "config.toml"

alias d := download-wheel

[private]
@default:
    @just --list

@download-wheel:
    $config = Get-Content ".\{{ config_file }}" -Raw; \
    $pyodideVersion = ([regex]::Match($config, '(?m)^\s*pyodide_version\s*=\s*"([^"]+)"')).Groups[1].Value; \
    $wheelVersion = ([regex]::Match($config, '(?m)^\s*wheel_version\s*=\s*"([^"]+)"')).Groups[1].Value; \
    $wheelPattern = ([regex]::Match($config, '(?m)^\s*wheel_pattern\s*=\s*"([^"]+)"')).Groups[1].Value; \
    if (-not $pyodideVersion) { throw "Missing pyodide_version in {{ config_file }}." }; \
    if (-not $wheelVersion) { throw "Missing wheel_version in {{ config_file }}." }; \
    if (-not $wheelPattern) { throw "Missing wheel_pattern in {{ config_file }}." }; \
    New-Item -ItemType Directory -Force -Path .\site\public\wheels | Out-Null; \
    $existing = Get-ChildItem .\site\public\wheels -Filter "*.whl" -ErrorAction Ignore; \
    if ($existing) { $existing | Remove-Item -Force }; \
    if ($wheelVersion -eq "latest") { \
      gh release download --repo lava-sh/yaml-rs --pattern $wheelPattern --dir .\site\public\wheels --clobber; \
    } else { \
      gh release download $wheelVersion --repo lava-sh/yaml-rs --pattern "*$wheelVersion$wheelPattern" --dir .\site\public\wheels --clobber; \
    }; \
    $asset = Get-ChildItem .\site\public\wheels -Filter "*.whl" | Select-Object -First 1; \
    if (-not $asset) { throw "No wheel matching $wheelPattern was downloaded." }; \
    $siteConfig = @( \
      "pyodide_version = `"$pyodideVersion`"", \
      "wheel_version = `"$wheelVersion`"", \
      "wheel_file = `"$($asset.Name)`"" \
    ); \
    $siteConfig | Set-Content .\site\public\config.toml
