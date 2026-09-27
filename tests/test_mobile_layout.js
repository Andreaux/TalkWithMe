/**
 * test_mobile_layout.js — Regression tests for the small-screen layout
 * controls (static/layout.js) and their wiring in templates/index.html.
 *
 * Run with plain Node (Node 20+, no npm packages, no network):
 *
 *     node tests/test_mobile_layout.js
 *
 * Invariants under test:
 *
 * 1. ☰ toggles the sidebar drawer (body.sidebar-open) and mirrors the state
 *    in its aria-expanded; tapping the backdrop closes it.
 * 2. ⋯ toggles the collapsed top-bar menu (#topbar-menu.open) with
 *    aria-expanded, without the same click closing it again via the
 *    document-level "tap outside" listener.
 * 3. At most one of the two is open: opening one closes the other.
 * 4. Choosing a menu button closes the menu; changing the theme <select>
 *    inside it does not. A tap outside the open menu closes it.
 * 5. Escape closes both; switching chat rooms closes the drawer.
 * 6. index.html wires it up: the four elements exist, viewport-fit=cover is
 *    set (safe-area insets), and layout.js loads before app.js.
 *
 * How it works: the browser scripts share globals (no ES modules), so each
 * test evaluates state.js + layout.js in a fresh vm.Context against a small
 * DOM stub with real event dispatch (bubbling to the document, honouring
 * stopPropagation), then drives setupLayoutControls() through clicks.
 *
 * NOTE: this file is intentionally NOT part of the pytest suite (which
 * must run with nothing but Python installed). Run it alongside:
 *     python3 -m pytest
 *     node tests/test_mobile_layout.js
 */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "static");
// Load order mirrors templates/index.html: state first, layout before app.
const APP_SCRIPTS = ["state.js", "layout.js"];

/* ==========================================================================
    DOM stub
    ========================================================================== */

function makeClassList() {
    const set = new Set();
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle(c, force) {
            const want = force === undefined ? !set.has(c) : Boolean(force);
            if (want) set.add(c); else set.delete(c);
            return want;
        },
    };
}

function makeElement(tag, id, parent = null) {
    const listeners = {};
    const attrs = {};
    const el = {
        tagName: tag.toUpperCase(),
        id,
        parent,
        classList: makeClassList(),
        style: {},
        value: "",
        setAttribute: (k, v) => { attrs[k] = String(v); },
        getAttribute: (k) => (k in attrs ? attrs[k] : null),
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        _listeners: listeners,
        contains(other) {
            for (let n = other; n; n = n.parent) if (n === el) return true;
            return false;
        },
        closest(selector) {
            // The stub only needs tag selectors ("button").
            for (let n = el; n; n = n.parent) if (n.tagName === selector.toUpperCase()) return n;
            return null;
        },
    };
    return el;
}

function createHarness() {
    const body = makeElement("body", "body");
    const docListeners = {};
    const els = {};
    const add = (tag, id, parent = body) => (els[id] = makeElement(tag, id, parent));

    const topbar = add("header", "topbar");
    add("button", "btn-sidebar-toggle", topbar);
    const menu = add("div", "topbar-menu", topbar);
    add("select", "theme-select", menu);
    add("button", "btn-persona-editor", menu);
    add("button", "btn-new-chat", menu);
    add("button", "btn-topbar-menu", topbar);
    add("aside", "sidebar");
    add("div", "sidebar-backdrop");
    add("select", "chat-room-dropdown", els["sidebar"]);
    add("div", "messages");

    const document = {
        body,
        getElementById: (id) => els[id] || makeElement("div", id),
        addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    };

    /** Dispatch like a browser: target, its ancestors, then the document. */
    function fire(target, type, extra = {}) {
        let stopped = false;
        const event = { type, target, stopPropagation() { stopped = true; }, ...extra };
        for (let n = target; n && !stopped; n = n.parent) {
            for (const fn of n._listeners[type] || []) fn(event);
        }
        if (!stopped) for (const fn of docListeners[type] || []) fn(event);
        return event;
    }

    const ctx = vm.createContext({ console, document });
    for (const name of APP_SCRIPTS) {
        vm.runInContext(fs.readFileSync(path.join(STATIC_DIR, name), "utf8"), ctx, { filename: name });
    }
    ctx.setupLayoutControls();

    return {
        els, body, fire,
        click: (id) => fire(els[id], "click"),
        key: (k) => fire(body, "keydown", { key: k }),
        drawerOpen: () => body.classList.contains("sidebar-open"),
        menuOpen: () => els["topbar-menu"].classList.contains("open"),
        aria: (id) => els[id].getAttribute("aria-expanded"),
    };
}

/* ==========================================================================
    Tests
    ========================================================================== */

test("☰ toggles the sidebar drawer and its aria-expanded", () => {
    const h = createHarness();
    h.click("btn-sidebar-toggle");
    assert.equal(h.drawerOpen(), true);
    assert.equal(h.aria("btn-sidebar-toggle"), "true");
    h.click("btn-sidebar-toggle");
    assert.equal(h.drawerOpen(), false);
    assert.equal(h.aria("btn-sidebar-toggle"), "false");
});

test("tapping the backdrop closes the drawer", () => {
    const h = createHarness();
    h.click("btn-sidebar-toggle");
    h.click("sidebar-backdrop");
    assert.equal(h.drawerOpen(), false);
});

test("⋯ opens the menu and the same click does not close it again", () => {
    const h = createHarness();
    const ev = h.click("btn-topbar-menu");
    assert.equal(h.menuOpen(), true, "the document-level outside-tap listener must not undo the open");
    assert.equal(h.aria("btn-topbar-menu"), "true");
    assert.ok(ev, "event dispatched");
    h.click("btn-topbar-menu");
    assert.equal(h.menuOpen(), false);
    assert.equal(h.aria("btn-topbar-menu"), "false");
});

test("opening one panel closes the other", () => {
    const h = createHarness();
    h.click("btn-sidebar-toggle");
    h.click("btn-topbar-menu");
    assert.equal(h.menuOpen(), true);
    assert.equal(h.drawerOpen(), false);
    h.click("btn-sidebar-toggle");
    assert.equal(h.drawerOpen(), true);
    assert.equal(h.menuOpen(), false);
});

test("choosing a menu button closes the menu", () => {
    const h = createHarness();
    h.click("btn-topbar-menu");
    h.click("btn-persona-editor");
    assert.equal(h.menuOpen(), false);
    assert.equal(h.aria("btn-topbar-menu"), "false");
});

test("changing the theme select keeps the menu open", () => {
    const h = createHarness();
    h.click("btn-topbar-menu");
    h.click("theme-select");
    assert.equal(h.menuOpen(), true);
});

test("a tap outside the open menu closes it", () => {
    const h = createHarness();
    h.click("btn-topbar-menu");
    h.click("messages");
    assert.equal(h.menuOpen(), false);
});

test("Escape closes both panels", () => {
    const h = createHarness();
    h.click("btn-sidebar-toggle");
    h.key("Escape");
    assert.equal(h.drawerOpen(), false);
    h.click("btn-topbar-menu");
    h.key("Escape");
    assert.equal(h.menuOpen(), false);
    h.click("btn-topbar-menu");
    h.key("Enter");
    assert.equal(h.menuOpen(), true, "other keys leave it alone");
});

test("switching chat rooms closes the drawer", () => {
    const h = createHarness();
    h.click("btn-sidebar-toggle");
    h.fire(h.els["chat-room-dropdown"], "change");
    assert.equal(h.drawerOpen(), false);
});

test("index.html wires up the small-screen layout", () => {
    const html = fs.readFileSync(path.join(ROOT, "templates", "index.html"), "utf8");
    for (const id of ["btn-sidebar-toggle", "sidebar-backdrop", "btn-topbar-menu", "topbar-menu"]) {
        assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
    }
    assert.match(html, /name="viewport"[^>]*viewport-fit=cover/, "safe-area insets need viewport-fit=cover");
    const layoutAt = html.indexOf('src="/static/layout.js"');
    const appAt = html.indexOf('src="/static/app.js"');
    assert.ok(layoutAt > 0 && layoutAt < appAt, "layout.js must load before app.js");
});
