/**
 * layout.js — Small-screen layout controls.
 *
 * On narrow screens (see the "Small screens" section of style.css) the
 * sidebar becomes an off-canvas drawer opened by the ☰ button, and the
 * secondary top-bar controls (theme, Personas, Chat Rooms, Settings,
 * Servers, New Chat) collapse into a "more" menu opened by the ⋯ button.
 * Both toggle buttons are hidden by CSS on wide screens, so this module is
 * inert there.
 *
 * State lives in the DOM, not in globals: body.sidebar-open for the drawer,
 * #topbar-menu.open for the menu, each mirrored in its button's
 * aria-expanded. At most one of the two is open at a time.
 */

/** Open or close the sidebar drawer. */
function setSidebarOpen(open) {
    document.body.classList.toggle("sidebar-open", open);
    sidebarToggleBtn.setAttribute("aria-expanded", String(open));
    if (open) setTopbarMenuOpen(false);
}

/** Open or close the collapsed top-bar menu. */
function setTopbarMenuOpen(open) {
    topbarMenuEl.classList.toggle("open", open);
    topbarMenuBtn.setAttribute("aria-expanded", String(open));
    if (open) setSidebarOpen(false);
}

function isSidebarOpen() {
    return document.body.classList.contains("sidebar-open");
}

function isTopbarMenuOpen() {
    return topbarMenuEl.classList.contains("open");
}

function setupLayoutControls() {
    sidebarToggleBtn.addEventListener("click", () => setSidebarOpen(!isSidebarOpen()));
    sidebarBackdropEl.addEventListener("click", () => setSidebarOpen(false));

    topbarMenuBtn.addEventListener("click", (e) => {
        // Keep this click from reaching the document listener below, which
        // would immediately close the menu it just opened.
        e.stopPropagation();
        setTopbarMenuOpen(!isTopbarMenuOpen());
    });

    // Choosing a menu button (its own handler opens a modal or starts a new
    // chat) closes the menu. The theme <select> is not a button, so picking
    // a theme keeps the menu open to try another.
    topbarMenuEl.addEventListener("click", (e) => {
        if (e.target.closest("button")) setTopbarMenuOpen(false);
    });

    // A tap anywhere outside the open menu closes it.
    document.addEventListener("click", (e) => {
        if (isTopbarMenuOpen() && !topbarMenuEl.contains(e.target)) {
            setTopbarMenuOpen(false);
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            setSidebarOpen(false);
            setTopbarMenuOpen(false);
        }
    });

    // Switching chat rooms is navigation: close the drawer to show the room.
    chatRoomDropdown.addEventListener("change", () => setSidebarOpen(false));
}
