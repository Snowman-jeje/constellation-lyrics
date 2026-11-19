#!/usr/bin/env bash
# Setup desktop icon and GNOME Super+M shortcut for Constellation Lyrics

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="${HOME}/.local/share/applications"
mkdir -p "${DESKTOP_DIR}"

echo "📦 Installing desktop launcher..."
cp "${DIR}/launcher/constellation.desktop" "${DESKTOP_DIR}/"
update-desktop-database "${DESKTOP_DIR}" 2>/dev/null || true

echo "⌨️  Configuring GNOME Custom Shortcut (Super+M)..."
KEY_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom-constellation/"
EXISTING=$(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings)

if [[ "$EXISTING" != *"$KEY_PATH"* ]]; then
  if [ "$EXISTING" = "@as []" ] || [ -z "$EXISTING" ]; then
    NEW_LIST="['$KEY_PATH']"
  else
    NEW_LIST="${EXISTING%]*}, '$KEY_PATH']"
  fi
  gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "$NEW_LIST"
fi

gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$KEY_PATH name 'Constellation Lyrics'
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$KEY_PATH command "${DIR}/launcher/constellation"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:$KEY_PATH binding '<Super>m'

echo "✅ Installed! You can now press Super+M or search 'Constellation Lyrics' in GNOME to toggle it."
