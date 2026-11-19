#!/usr/bin/env python3
"""
Native GNOME Window Wrapper using GTK3 & WebKit2.
Provides borderless, hardware-accelerated fullscreen presentation.
Bypasses cache with timestamp query param for fresh updates.
"""

import sys
import time
import signal
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, Gdk, WebKit2, GLib

class ConstellationWindow(Gtk.Window):
    def __init__(self, base_url):
        super().__init__(title="Constellation Lyrics")
        self.set_default_size(1280, 800)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_decorated(False)
        self.fullscreen()

        # WebKit WebView
        self.webview = WebKit2.WebView()
        settings = self.webview.get_settings()
        settings.set_enable_developer_extras(False)
        settings.set_enable_webgl(True)
        settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)

        # Deep black background
        bg_color = Gdk.RGBA(0.02, 0.02, 0.03, 1.0)
        self.webview.set_background_color(bg_color)

        self.add(self.webview)

        # Timestamp cache-buster query
        separator = '&' if '?' in base_url else '?'
        fresh_url = f"{base_url}{separator}_t={int(time.time())}"
        self.webview.load_uri(fresh_url)

        self.connect("destroy", Gtk.main_quit)
        self.connect("key-press-event", self.on_key_press)

    def on_key_press(self, widget, event):
        if event.keyval in (Gdk.KEY_Escape, Gdk.KEY_q, Gdk.KEY_Q):
            self.destroy()
            return True
        elif event.keyval == Gdk.KEY_F11:
            if self.get_window().get_state() & Gdk.WindowState.FULLSCREEN:
                self.unfullscreen()
                self.set_decorated(True)
            else:
                self.set_decorated(False)
                self.fullscreen()
            return True
        return False

def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9876"
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, Gtk.main_quit)
    win = ConstellationWindow(url)
    win.show_all()
    Gtk.main()

if __name__ == '__main__':
    main()
