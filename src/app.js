const API = "https://tunnelforce.com";

let config = null;
let walletAddress = null;
let jwt = localStorage.getItem("jwt");

// WalletConnect state
let signClient = null;
let wcSession = null;

// --- DOM ---

const $stepConnect = document.getElementById("step-connect");
const $stepAuth = document.getElementById("step-auth");
const $stepAuthenticated = document.getElementById("step-authenticated");
const $displayAddress = document.getElementById("display-address");
const $displayUsername = document.getElementById("display-username");
const $displayUserId = document.getElementById("display-user-id");
const $displayUserWallet = document.getElementById("display-user-wallet");
const $usernameForm = document.getElementById("username-form");
const $status = document.getElementById("status");
const $inputUsername = document.getElementById("input-username");
const $usernameIndicator = document.getElementById("username-indicator");
const $btnClaimUsername = document.getElementById("btn-claim-username");
const $btnLogin = document.getElementById("btn-login");
const $btnRegister = document.getElementById("btn-register");
const $wcModal = document.getElementById("wc-modal");
const $wcUri = document.getElementById("wc-uri");
const $wcClose = document.getElementById("wc-close");

// --- Helpers ---

function status(msg, isError = false) {
    $status.textContent = msg ? msg.toUpperCase() : "";
    $status.className = isError ? "status error" : "status";
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
        if (code === 409) throw new Error("Already exists");
        if (code === 402) throw new Error("Payment not found");
        if (code === 401) throw new Error("Unauthorized");
        if (code === 404) throw new Error("Not found");
        if (code === 400) throw new Error("Bad request");
        throw new Error(`HTTP ${code}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_ATTRS = { viewBox: "0 0 24 24", fill: "none", stroke: "#555", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };

function createIcon(children) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of Object.entries(ICON_ATTRS)) svg.setAttribute(k, v);
    for (const [tag, attrs] of children) {
        const el = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        svg.appendChild(el);
    }
    return svg;
}

const ICONS = {
    check: () => createIcon([["polyline", { points: "20 6 9 17 4 12" }]]),
    cross: () => createIcon([["line", { x1: 18, y1: 6, x2: 6, y2: 18 }], ["line", { x1: 6, y1: 6, x2: 18, y2: 18 }]]),
};

function setIndicator(name) {
    $usernameIndicator.replaceChildren();
    if (name) $usernameIndicator.appendChild(ICONS[name]());
}

function showStep(step) {
    $stepConnect.hidden = step !== "connect";
    $stepAuth.hidden = step !== "auth";
    $stepAuthenticated.hidden = step !== "authenticated";
}

// --- ERC-20 transfer encoding ---

function encodeTransfer(to, amount) {
    const addr = to.toLowerCase().replace("0x", "").padStart(64, "0");
    const value = amount.toString(16).padStart(64, "0");
    return "0xa9059cbb" + addr + value;
}

// --- WalletConnect ---

async function initWalletConnect() {
    const { SignClient } = await import("@walletconnect/sign-client");
    signClient = await SignClient.init({
        projectId: "WALLETCONNECT_PROJECT_ID",
        metadata: {
            name: "0xFRAG",
            description: "Multiplayer FPS",
            url: "https://tunnelforce.com",
            icons: [],
        },
    });
}

function showWcModal(uri) {
    $wcUri.value = uri;
    $wcModal.hidden = false;
}

function hideWcModal() {
    $wcModal.hidden = true;
}

async function connectWallet() {
    try {
        status("Loading config...");
        config = await api("GET", "/api/config");

        status("Initializing WalletConnect...");
        if (!signClient) await initWalletConnect();

        const chainId = `eip155:${config.chain_id}`;

        const { uri, approval } = await signClient.connect({
            requiredNamespaces: {
                eip155: {
                    methods: ["personal_sign", "eth_sendTransaction"],
                    chains: [chainId],
                    events: ["accountsChanged"],
                },
            },
        });

        if (uri) {
            showWcModal(uri);
        }

        status("Approve in your wallet...");
        wcSession = await approval();
        hideWcModal();

        const accounts = wcSession.namespaces.eip155.accounts;
        // Format: "eip155:CHAIN_ID:0xADDRESS"
        walletAddress = accounts[0].split(":")[2].toLowerCase();
        $displayAddress.textContent = walletAddress;

        const { registered } = await api("GET", `/api/auth/check/${walletAddress}`);
        $btnLogin.hidden = !registered;
        $btnRegister.hidden = registered;

        showStep("auth");
        status("");
    } catch (e) {
        hideWcModal();
        status(e.message, true);
    }
}

async function wcRequest(method, params) {
    const chainId = `eip155:${config.chain_id}`;
    return await signClient.request({
        topic: wcSession.topic,
        chainId,
        request: { method, params },
    });
}

async function getNonceAndSign() {
    status("Requesting nonce...");
    const { message } = await api("POST", "/api/auth/nonce", { wallet_address: walletAddress });

    status("Sign the message in your wallet...");
    const signature = await wcRequest("personal_sign", [message, walletAddress]);
    return signature;
}

// --- Auth ---

async function login() {
    try {
        const signature = await getNonceAndSign();
        status("Logging in...");
        const { token } = await api("POST", "/api/login", { wallet_address: walletAddress, signature });
        jwt = token;
        localStorage.setItem("jwt", jwt);
        await showAuthenticated();
    } catch (e) {
        status(e.message, true);
    }
}

async function register() {
    try {
        status("Approve USDC transfer in your wallet...");
        const txHash = await wcRequest("eth_sendTransaction", [{
            from: walletAddress,
            to: config.usdc_address,
            data: encodeTransfer(config.treasury_address, config.register_fee),
        }]);

        status("Waiting for transaction confirmation...");
        // Poll the RPC for receipt
        await waitForReceipt(txHash);

        const signature = await getNonceAndSign();

        status("Registering...");
        const { token } = await api("POST", "/api/register", {
            wallet_address: walletAddress,
            signature,
            tx_hash: txHash,
        });
        jwt = token;
        localStorage.setItem("jwt", jwt);
        await showAuthenticated();
    } catch (e) {
        status(e.message, true);
    }
}

async function waitForReceipt(txHash) {
    const rpcUrl = config.chain_rpc;
    while (true) {
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_getTransactionReceipt",
                params: [txHash],
                id: 1,
            }),
        });
        const data = await res.json();
        if (data.result) return data.result;
        await new Promise((r) => setTimeout(r, 2000));
    }
}

function logout() {
    jwt = null;
    walletAddress = null;
    wcSession = null;
    localStorage.removeItem("jwt");
    showStep("connect");
}

async function showAuthenticated() {
    try {
        const account = await api("GET", "/api/auth/me", null, true);
        $displayUsername.textContent = account.username || "\u2014";
        $displayUserId.textContent = account.id;
        $displayUserWallet.textContent = account.wallet_address;

        $usernameForm.hidden = !!account.username;

        showStep("authenticated");
        status("");
    } catch (e) {
        jwt = null;
        localStorage.removeItem("jwt");
        showStep("connect");
        status("Session expired", true);
    }
}

// --- Username ---

let checkTimeout = null;

function onUsernameInput() {
    const name = $inputUsername.value.trim().toLowerCase();
    setIndicator(null);
    $btnClaimUsername.disabled = true;

    if (checkTimeout) clearTimeout(checkTimeout);
    if (!name) return;
    if (name.length < 3) { setIndicator("cross"); return; }

    checkTimeout = setTimeout(() => checkUsername(name), 350);
}

async function checkUsername(name) {
    try {
        const { available } = await api("GET", `/api/username/${encodeURIComponent(name)}`);
        if ($inputUsername.value.trim().toLowerCase() !== name) return;

        if (available) {
            setIndicator("check");
            $btnClaimUsername.disabled = false;
        } else {
            setIndicator("cross");
        }
    } catch {
        setIndicator("cross");
    }
}

async function claimUsername() {
    const name = $inputUsername.value.trim().toLowerCase();
    if (!name) return;

    try {
        status("Claiming username...");
        await api("POST", "/api/username", { username: name }, true);
        await showAuthenticated();
    } catch (e) {
        status(e.message, true);
    }
}

// --- Events ---

document.getElementById("btn-connect").addEventListener("click", connectWallet);
$btnLogin.addEventListener("click", login);
$btnRegister.addEventListener("click", register);
$inputUsername.addEventListener("input", onUsernameInput);
$btnClaimUsername.addEventListener("click", claimUsername);
document.getElementById("btn-logout").addEventListener("click", logout);
$wcClose.addEventListener("click", hideWcModal);
document.getElementById("btn-sync").addEventListener("click", async () => {
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
        if (jwt) {
            await showAuthenticated();
        } else {
            showStep("connect");
        }
    } catch {
        showStep("connect");
    }
})();
