import { onOpenUrl, getCurrent } from "@tauri-apps/plugin-deep-link";
import { open } from "@tauri-apps/plugin-shell";
import { LazyStore } from "@tauri-apps/plugin-store";

const API = "https://0xfrag.com";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let jwt = null;
const store = new LazyStore("auth.json");

// --- DOM ---

const $stepLogin = document.getElementById("step-login");
const $stepAuthenticated = document.getElementById("step-authenticated");
const $displayUsername = document.getElementById("display-username");
const $displayUserId = document.getElementById("display-user-id");
const $displayUserWallet = document.getElementById("display-user-wallet");
const $status = document.getElementById("status");

// --- Helpers ---

function status(msg, isError = false) {
    $status.textContent = msg ? msg.toUpperCase() : "";
    $status.className = isError ? "status error" : "status";
}

function showStep(step) {
    $stepLogin.hidden = step !== "login";
    $stepAuthenticated.hidden = step !== "authenticated";
}

async function api(method, path, body = null, auth = false) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (auth && jwt) headers["Authorization"] = `Bearer ${jwt}`;
    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
    });
    if (!res.ok) {
        const code = res.status;
        if (code === 401) throw new Error("Unauthorized");
        if (code === 404) throw new Error("Not found");
        throw new Error(`HTTP ${code}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// --- Deep link URL parsing ---

function parseDeepLink(urlStr) {
    // Extract token and state from xfrag://callback?token=...&state=...
    // Use URL parser, with manual fallback for edge cases
    try {
        const url = new URL(urlStr);
        if (url.protocol === "xfrag:" && url.hostname === "callback") {
            return {
                token: url.searchParams.get("token"),
                state: url.searchParams.get("state"),
            };
        }
    } catch {
        // Fallback: manual string parsing
    }
    // Manual fallback — handles cases where URL() parser fails on custom schemes
    if (urlStr.startsWith("xfrag://callback")) {
        const qs = urlStr.split("?")[1];
        if (qs) {
            const params = new URLSearchParams(qs);
            return {
                token: params.get("token"),
                state: params.get("state"),
            };
        }
    }
    return null;
}

// --- Auth ---

async function loginViaBrowser() {
    const state = crypto.randomUUID();
    let unlisten = null;
    let timeout = null;

    try {
        status("Waiting for browser auth...");

        const authPromise = new Promise((resolve, reject) => {
            timeout = setTimeout(() => {
                reject(new Error("Auth timed out (5 min)"));
            }, AUTH_TIMEOUT_MS);

            // onOpenUrl receives urls: string[] from the deep-link plugin
            onOpenUrl((urls) => {
                for (const urlStr of urls) {
                    const parsed = parseDeepLink(urlStr);
                    if (!parsed) continue;

                    if (!parsed.token) {
                        reject(new Error("Callback missing token"));
                        return;
                    }
                    if (parsed.state !== state) {
                        reject(new Error("State mismatch — possible replay"));
                        return;
                    }

                    resolve(parsed.token);
                    return;
                }
            }).then((fn) => { unlisten = fn; });
        });

        await open(`${API}?state=${encodeURIComponent(state)}`);

        const token = await authPromise;
        jwt = token;
        await store.set("jwt", jwt);
        await store.save();
        await showAuthenticated();
    } catch (e) {
        status(e.message || "Auth failed", true);
    } finally {
        if (timeout) clearTimeout(timeout);
        if (unlisten) unlisten();
    }
}

async function showAuthenticated() {
    try {
        const account = await api("GET", "/api/auth/me", null, true);
        $displayUsername.textContent = account.username || "\u2014";
        $displayUserId.textContent = account.id;
        $displayUserWallet.textContent = account.wallet_address;

        showStep("authenticated");
        status("");
    } catch (e) {
        jwt = null;
        await store.delete("jwt");
        showStep("login");
        status("Session expired — login again", true);
    }
}

async function logout() {
    jwt = null;
    await store.delete("jwt");
    showStep("login");
    status("");
}

// --- Handle deep links received at cold startup ---

async function handleStartupDeepLink() {
    try {
        const urls = await getCurrent();
        if (!urls) return false;
        for (const urlStr of urls) {
            const parsed = parseDeepLink(urlStr);
            if (parsed && parsed.token) {
                jwt = parsed.token;
                await store.set("jwt", jwt);
                await store.save();
                return true;
            }
        }
    } catch {
        // No startup deep link
    }
    return false;
}

// --- Events ---

document.getElementById("btn-login").addEventListener("click", loginViaBrowser);
document.getElementById("btn-logout").addEventListener("click", logout);
document.getElementById("btn-play").addEventListener("click", async () => {
    const container = document.getElementById("game-container");
    try {
        status("Connecting to game server...");
        document.querySelector(".topbar").hidden = true;
        document.querySelector(".container").hidden = true;
        container.hidden = false;
        const { startGame } = await import("./game.js");
        const reason = await startGame(container, jwt);
        if (reason === "DUPLICATE") {
            status("Connection dropped due to duplicate sync session", true);
        } else {
            status("Disconnected from server");
        }
    } catch (e) {
        status(e.message || String(e), true);
    }
    document.querySelector(".topbar").hidden = false;
    document.querySelector(".container").hidden = false;
    container.hidden = true;
});

// --- Init ---

(async () => {
    try {
        // Check if app was cold-launched via a deep link (e.g. xfrag://callback?token=...)
        const fromDeepLink = await handleStartupDeepLink();
        if (fromDeepLink) {
            await showAuthenticated();
            return;
        }

        // Otherwise check stored JWT
        jwt = await store.get("jwt");
        if (jwt) {
            await showAuthenticated();
        } else {
            showStep("login");
        }
    } catch {
        showStep("login");
    }
})();
