#!/usr/bin/env bash
# Make Playwright's Chromium runnable on a bare Linux box with no root access.
#
# Headless hosts often lack the shared libraries and fonts Chromium needs, and
# `playwright install --with-deps` needs sudo. This downloads the .deb packages
# without installing them, unpacks them under .local/browser (gitignored), and
# writes .local/browser/env.sh for you to source. Safe to re-run.
#
#   scripts/browser-setup.sh        # once per checkout
#   . .local/browser/env.sh         # in every shell that runs a browser
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
base="$root/.local/browser"
libs="$base/root"
mkdir -p "$base/debs" "$base/apt/state/lists/partial" "$base/apt/cache/archives/partial" "$libs"

if [ ! -d "$root/node_modules/playwright" ]; then (cd "$root" && npm ci); fi
(cd "$root" && npx playwright install chromium)

# Skip the download when the browser already starts.
export LD_LIBRARY_PATH="$libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
shell="$(find "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" -name chrome-headless-shell -type f 2>/dev/null | head -1)"
if [ -n "$shell" ] && ! ldd "$shell" | grep -q "not found"; then
  echo "Chromium libraries already satisfied."
else
  apt_opts=(-o "Dir::State=$base/apt/state" -o "Dir::Cache=$base/apt/cache" -o Debug::NoLocking=1)
  apt-get "${apt_opts[@]}" update >/dev/null
  packages=(
    libglib2.0-0t64 libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libdbus-1-3
    libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libxcb1
    libxkbcommon0 libasound2t64 libatspi2.0-0t64 libxau6 libxdmcp6 libxres1 libpcre2-8-0
    libffi8 libwayland-server0 libdrm2 libbsd0 libmd0 libcap2 libxi6 libxrender1 libxtst6
    libcups2t64 libpango-1.0-0 libcairo2 libfontconfig1 libfreetype6 libexpat1 libxcb-render0
    libxcb-shm0 libxcb-randr0 libxshmfence1 libpixman-1-0 libharfbuzz0b libfribidi0 libthai0
    libdatrie1 libgraphite2-3 libpng16-16t64 fonts-liberation
  )
  (cd "$base/debs" && apt-get "${apt_opts[@]}" download "${packages[@]}")
  for deb in "$base"/debs/*.deb; do dpkg -x "$deb" "$libs"; done
fi

if [ -n "$shell" ] && ldd "$shell" | grep "not found"; then
  echo "Chromium still has unresolved libraries (above). Add the matching package to scripts/browser-setup.sh." >&2
  exit 1
fi

cat > "$base/fonts.conf" <<CONF
<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>$libs/usr/share/fonts</dir><cachedir>$base/fontcache</cachedir>
<alias><family>sans-serif</family><prefer><family>Liberation Sans</family></prefer></alias>
<alias><family>serif</family><prefer><family>Liberation Serif</family></prefer></alias>
<alias><family>monospace</family><prefer><family>Liberation Mono</family></prefer></alias>
</fontconfig>
CONF

cat > "$base/env.sh" <<ENV
export LD_LIBRARY_PATH="$libs/usr/lib/x86_64-linux-gnu\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
export FONTCONFIG_FILE="$base/fonts.conf"
ENV
echo "Done. Run: . .local/browser/env.sh"
