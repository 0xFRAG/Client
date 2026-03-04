import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { Store } from "@tauri-apps/plugin-store";

const API = "https://0xfrag.com";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let jwt = null;
const store = new Store("auth.json");

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

function generateState() {
    return crypto.randomUUID();
}

// --- Auth ---

async function loginViaBrowser() {
    const state = generateState();
    let unlisten = null;
    let timeout = null;

    try {
        status("Waiting for browser auth...");

        const authPromise = new Promise((resolve, reject) => {
            // Timeout after 5 minutes
            timeout = setTimeout(() => {
                reject(new Error("Auth timed out (5 min)"));
            }, AUTH_TIMEOUT_MS);

            // Listen for deep link callback
            listen("deep-link", (event) => {
                const urlStr = event.payload;
                let url;
                try {
                    url = new URL(urlStr);
                } catch {
                    return; // ignore malformed URLs
                }

                if (url.host !== "callback") return;

                const token = url.searchParams.get("token");
                const returnedState = url.searchParams.get("state");

                if (!token || returnedState !== state) {
                    reject(new Error("Invalid callback: state mismatch"));
                    return;
                }

                resolve(token);
            }).then((fn) => { unlisten = fn; });
        });

        // Open browser with state param
        await open(`${API}?state=${encodeURIComponent(state)}`);

        const token = await authPromise;
        jwt = token;
        await store.set("jwt", jwt);
        await showAuthenticated();
    } catch (e) {
        status(e.message, true);
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
        status("Session expired", true);
    }
}

async function logout() {
    jwt = null;
    await store.delete("jwt");
    showStep("login");
    status("");
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
