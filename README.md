# Script Launcher

A Cinnamon panel applet for Linux Mint that lists the shell scripts in a
folder and runs the one you pick in a terminal.

Click the panel button, pick a script, and it runs. Drop a new `.sh` file
into the folder and it shows up the next time you open the menu, with no
reload needed.

## Requirements

- Cinnamon 6.4 or 6.6 (developed on Linux Mint 22.3, Cinnamon 6.6, X11)
- A terminal: gnome-terminal is preferred, but any terminal set as
  Cinnamon's default works

## Install

```bash
git clone https://github.com/jammuth/cinnamon-script-launcher.git
cd cinnamon-script-launcher
./test.sh
```

`test.sh` symlinks the applet into `~/.local/share/cinnamon/applets/` and
reloads Cinnamon. Because it's a symlink, a `git pull` followed by a
Cinnamon reload (Ctrl+Alt+Esc) picks up updates.

If you'd rather not use a symlink, copy the applet folder in yourself:

```bash
cp -r files/script-launcher@jamesa ~/.local/share/cinnamon/applets/
```

Then add it to your panel: right-click the panel → **Applets**, find
**Script Launcher**, and click **+**.

## Set up

Right-click the applet → **Configure…** and choose a **Scripts folder**.
Any folder works, for example `~/scripts`.

Every non-hidden `*.sh` file in that folder appears in the menu, sorted by
name. Scripts are run with `bash`, so they don't need to be executable.

### Menu labels

The menu label comes from the filename: the `.sh` is dropped, dashes and
underscores become spaces, and each word is capitalised.

| File                     | Menu label          |
|--------------------------|---------------------|
| `branch-cleanup.sh`      | Branch Cleanup      |
| `open-scripts-folder.sh` | Open Scripts Folder |
| `backup_photos.sh`       | Backup Photos       |

## Closing the terminal automatically (optional)

By default the script runs in gnome-terminal with your normal profile, so
the window does whatever that profile does when a command finishes. That's
often holding the window open with a "child process exited" banner.

To have windows close themselves when a script finishes, create a
gnome-terminal profile with exactly this name:

1. Open Terminal → **Preferences**.
2. Click **+** next to **Profiles** and name it
   `Script Launcher (auto-close)`.
3. In that profile's **Command** tab, set **When command exits** to
   **Exit the terminal**.

The applet uses that profile automatically when it exists. Your default
profile isn't changed.

## Writing scripts

The terminal may close as soon as your script ends, so a few patterns help.

**Keep output on screen.** End with a pause, or use a `trap` so it pauses
even when a command fails:

```bash
#!/usr/bin/env bash
set -uo pipefail
trap 'echo; read -rp "Press Enter to close..."' EXIT

sudo apt update && sudo apt upgrade
```

**Opening a GUI app.** Closing a terminal kills everything it started,
including apps started in the background with `&`, `nohup`, `setsid` or
`disown`. Hand the app to systemd instead; this returns straight away, so
the terminal can close while the app keeps running:

```bash
#!/usr/bin/env bash
systemd-run --user --quiet --collect firefox
```

**Opening a folder.** Ask the file manager over D-Bus:

```bash
#!/usr/bin/env bash
gdbus call --session \
    --dest org.freedesktop.FileManager1 \
    --object-path /org/freedesktop/FileManager1 \
    --method org.freedesktop.FileManager1.ShowFolders \
    "['file://$HOME/scripts']" "" >/dev/null
```

**Long-running commands** (a server, `tail -f`) need nothing special: the
window stays open while they run.

## Uninstall

Remove the applet from the panel, then:

```bash
./test.sh --unlink
```

or delete `~/.local/share/cinnamon/applets/script-launcher@jamesa`.

## Troubleshooting

Open Looking Glass (Alt+F2, type `lg`, Enter) to see errors from the
applet.
