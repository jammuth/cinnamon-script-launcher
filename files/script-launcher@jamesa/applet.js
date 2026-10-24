/*
 * Script Launcher — a Cinnamon panel applet that runs scripts from a menu.
 *
 * Target: Cinnamon 6.6.x, CJS 115 (SpiderMonkey 115), X11.
 *
 * NOTE ON MODULE SYSTEM:
 *   Applets load via Cinnamon's GJS-style `imports.*` system, NOT ES `import`.
 *   The *language* inside is fully modern (classes, async/await, arrow fns,
 *   optional chaining), but the module wiring below stays `imports.*`.
 */

const Applet = imports.ui.applet;          // base applet classes
const PopupMenu = imports.ui.popupMenu;    // dropdown menu widgets
const GLib = imports.gi.GLib;              // low-level helpers (timers, paths)
const Gio = imports.gi.Gio;                // file/directory access
const St = imports.gi.St;                  // Shell Toolkit widgets
const Settings = imports.ui.settings;      // settings-schema.json binding
const Gettext = imports.gettext;           // translations
const Util = imports.misc.util;            // spawnCommandLine helper
const Main = imports.ui.main;              // notifications

const UUID = "script-launcher@jamesa";

// --- i18n helper -----------------------------------------------------------
// Binds this applet's translation domain; falls back to the raw string.
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");
function _(str) {
    const translated = Gettext.dgettext(UUID, str);
    return translated !== str ? translated : Gettext.gettext(str);
}

// The filechooser setting widget stores a file:// URI, not a plain path.
function uriToPath(uri) {
    if (!uri.startsWith("file://"))
        return uri;
    try {
        return GLib.filename_from_uri(uri, null)[0];
    } catch (e) {
        return decodeURIComponent(uri.replace(/^file:\/\//, ""));
    }
}

// Optional gnome-terminal profile with exit-action=close, so the window shuts
// when the script exits instead of showing the "child process exited" banner.
// Users create it themselves; without it we fall back below.
const AUTO_CLOSE_PROFILE = "Script Launcher (auto-close)";

// True if a gnome-terminal profile with this visible name exists. Reads
// dconf through GSettings, so it's cheap enough to check on every run.
function terminalProfileExists(name) {
    const source = Gio.SettingsSchemaSource.get_default();
    if (!source.lookup("org.gnome.Terminal.ProfilesList", true) ||
        !source.lookup("org.gnome.Terminal.Legacy.Profile", true))
        return false;

    const ids = new Gio.Settings({ schema_id: "org.gnome.Terminal.ProfilesList" })
        .get_strv("list");
    return ids.some(id => new Gio.Settings({
        schema_id: "org.gnome.Terminal.Legacy.Profile",
        path: `/org/gnome/terminal/legacy/profiles:/:${id}/`,
    }).get_string("visible-name") === name);
}

// Builds the command line that runs `bash <scriptPath>` in a terminal:
//   1. gnome-terminal with the auto-close profile, if it exists
//   2. gnome-terminal with the user's default profile
//   3. whatever terminal Cinnamon is configured to use
function terminalCommand(scriptPath) {
    const script = "bash " + GLib.shell_quote(scriptPath);

    if (GLib.find_program_in_path("gnome-terminal")) {
        const profile = terminalProfileExists(AUTO_CLOSE_PROFILE)
            ? "--profile=" + GLib.shell_quote(AUTO_CLOSE_PROFILE) + " "
            : "";
        return "gnome-terminal " + profile + "-- " + script;
    }

    const prefs = new Gio.Settings({
        schema_id: "org.cinnamon.desktop.default-applications.terminal",
    });
    const exec = prefs.get_string("exec") || "x-terminal-emulator";
    const execArg = prefs.get_string("exec-arg") || "-e";
    return `${exec} ${execArg} ${script}`;
}

// "open-scripts-folder.sh" -> "Open Scripts Folder" (splits on - and _).
function scriptLabel(fileName) {
    return fileName
        .replace(/\.sh$/, "")
        .split(/[-_]+/)
        .filter(word => word.length > 0)
        .map(word => word[0].toUpperCase() + word.slice(1))
        .join(" ");
}

// ---------------------------------------------------------------------------
// The applet class.
//
// We extend Applet.TextIconApplet with a native ES class. `super(...)` chains
// into Cinnamon's legacy constructor, which calls the base `_init(...)`.
// IMPORTANT: super() takes (orientation, panelHeight, instanceId) — metadata
// is NOT passed to super(); it arrives as the first arg to our constructor.
//
// FALLBACK: if a future Cinnamon build rejects `extends` on the applet base
// classes, switch to the prototype pattern (see CLAUDE.md → Gotchas).
// ---------------------------------------------------------------------------
class ScriptLauncherApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this.metadata = metadata;
        this.instanceId = instanceId;

        // --- panel presentation ---
        this.set_applet_icon_symbolic_name("system-run-symbolic");
        this.set_applet_label(_("Scripts"));
        this.set_applet_tooltip(_("Click to pick a script to run"));

        // --- popup menu (one item per script, rebuilt on every open) ---
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        // --- settings (bound to settings-schema.json) ---
        // bind(schemaKey, thisPropertyName, callback)
        this.settings = new Settings.AppletSettings(this, UUID, instanceId);
        this.settings.bind("scripts-dir", "scriptsDir");
    }

    // Returns sorted [{name, path}] for the non-hidden *.sh files in the
    // configured folder. A small local directory listing, so doing it
    // synchronously on click doesn't stall the panel.
    _listScripts() {
        const dir = Gio.File.new_for_path(uriToPath(this.scriptsDir));
        const scripts = [];
        const enumerator = dir.enumerate_children(
            "standard::name,standard::type,standard::is-hidden",
            Gio.FileQueryInfoFlags.NONE, null);

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (info.get_file_type() !== Gio.FileType.REGULAR ||
                info.get_is_hidden() || !name.endsWith(".sh"))
                continue;
            scripts.push({
                name: scriptLabel(name),
                path: dir.get_child(name).get_path(),
            });
        }
        enumerator.close(null);

        return scripts.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Clears and refills the menu from the scripts folder.
    _rebuildMenu() {
        this.menu.removeAll();

        if (!this.scriptsDir) {
            this._addInfoItem(_("No scripts folder set — choose one in the applet settings."));
            return;
        }

        let scripts;
        try {
            scripts = this._listScripts();
        } catch (e) {
            global.logError(e);
            this._addInfoItem(_("Can't read scripts folder: ") + e.message);
            return;
        }

        if (scripts.length === 0) {
            this._addInfoItem(_("No .sh scripts in the scripts folder."));
            return;
        }

        for (const script of scripts) {
            const item = new PopupMenu.PopupIconMenuItem(
                script.name, "utilities-terminal-symbolic", St.IconType.SYMBOLIC);
            item.connect("activate", () => this._runScript(script.path));
            this.menu.addMenuItem(item);
        }
    }

    _addInfoItem(text) {
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(text, { reactive: false }));
    }

    // Opens a terminal and runs the given script.
    _runScript(scriptPath) {
        // Run through bash explicitly (works whether or not the script is
        // chmod +x), in the best terminal available (see terminalCommand).
        try {
            Util.spawnCommandLine(terminalCommand(scriptPath));
        } catch (e) {
            global.logError(e);
            Main.notify(_("Script Launcher"), _("Failed to run script: ") + e.message);
        }
    }

    // Fired when the user clicks the applet in the panel.
    on_applet_clicked() {
        if (!this.menu.isOpen)
            this._rebuildMenu();
        this.menu.toggle();
    }

    // Fired when the applet is removed or Cinnamon reloads — clean up here.
    on_applet_removed_from_panel() {
        this.settings.finalize();
        this.menu.destroy();
    }
}

// Cinnamon's entry point. Must be named `main` and return the applet instance.
function main(metadata, orientation, panelHeight, instanceId) {
    return new ScriptLauncherApplet(metadata, orientation, panelHeight, instanceId);
}
