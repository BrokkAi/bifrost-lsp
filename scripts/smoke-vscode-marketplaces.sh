#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: smoke-vscode-marketplaces.sh VERSION [EXPECTED_VSIX]}"
expected_vsix="${2:-}"
attempts="${SMOKE_ATTEMPTS:-12}"
delay="${SMOKE_DELAY_SECONDS:-10}"

if [[ -n "$expected_vsix" ]]; then
  expected_hash="$(sha256sum "$expected_vsix" | cut -d ' ' -f 1)"
fi

for ((attempt = 1; attempt <= attempts; attempt++)); do
  rm -f marketplace.json marketplace.vsix open-vsx.json open-vsx.vsix
  if jq -n '{filters:[{criteria:[{filterType:7,value:"brokk.bifrost-vscode"}],pageNumber:1,pageSize:1}],flags:914}' > marketplace-query.json \
    && curl --fail --silent --show-error --location \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json;api-version=7.2-preview.1' \
      --data-binary @marketplace-query.json \
      https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery > marketplace.json \
    && jq -e --arg version "$version" \
      '[.results[0].extensions[0].versions[] | select(.version == $version)] | length == 1' \
      marketplace.json >/dev/null \
    && curl --fail --silent --show-error --location \
      "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/brokk/vsextensions/bifrost-vscode/${version}/vspackage" \
      -o marketplace.vsix \
    && curl --fail --silent --show-error --location \
      "https://open-vsx.org/api/brokk/bifrost-vscode/${version}" > open-vsx.json \
    && open_vsx_url="$(jq -er '.files.download' open-vsx.json)" \
    && curl --fail --silent --show-error --location "$open_vsx_url" -o open-vsx.vsix; then
    marketplace_hash="$(sha256sum marketplace.vsix | cut -d ' ' -f 1)"
    open_vsx_hash="$(sha256sum open-vsx.vsix | cut -d ' ' -f 1)"
    open_vsx_sidecar="$(curl --fail --silent --show-error --location \
      "https://open-vsx.org/api/brokk/bifrost-vscode/${version}/file/brokk.bifrost-vscode-${version}.sha256" | tr -d '[:space:]')"
    unzip -tq marketplace.vsix
    unzip -tq open-vsx.vsix
    test "$open_vsx_hash" = "$open_vsx_sidecar"
    if [[ -n "$expected_vsix" ]]; then
      test "$marketplace_hash" = "$expected_hash"
      test "$open_vsx_hash" = "$expected_hash"
    fi
    exit 0
  fi
  if (( attempt < attempts )); then sleep "$delay"; fi
done

echo "Release $version did not become verifiable in both marketplaces" >&2
exit 1
