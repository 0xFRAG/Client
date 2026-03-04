export function createChatUI(container) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:12px;left:12px;width:360px;max-height:300px;overflow-y:auto;pointer-events:none;z-index:100;display:flex;flex-direction:column;gap:2px;";
    container.appendChild(overlay);

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 200;
    input.placeholder = "Press Enter to chat...";
    input.style.cssText = "position:fixed;bottom:16px;left:12px;width:360px;padding:8px 12px;background:rgba(0,0,0,0.7);color:white;border:1px solid rgba(255,255,255,0.2);border-radius:4px;font-family:Inter,sans-serif;font-size:14px;display:none;z-index:100;outline:none;";
    container.appendChild(input);

    function addChatLine(text) {
        const line = document.createElement("div");
        line.style.cssText = "padding:4px 8px;background:rgba(0,0,0,0.5);color:white;font-family:Inter,sans-serif;font-size:13px;border-radius:3px;pointer-events:none;transition:opacity 0.5s;";
        line.textContent = text;
        overlay.appendChild(line);
        overlay.scrollTop = overlay.scrollHeight;
        // Fade after 10s
        setTimeout(() => {
            line.style.opacity = "0";
            setTimeout(() => line.remove(), 500);
        }, 10000);
    }

    function dispose() {
        if (overlay.parentNode) overlay.remove();
        if (input.parentNode) input.remove();
    }

    return { overlay, input, addChatLine, dispose };
}

export function createHealthBar(container) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:200px;height:8px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.3);border-radius:4px;overflow:hidden;z-index:150;display:none;";
    const fill = document.createElement("div");
    fill.style.cssText = "width:100%;height:100%;background:#e44;transition:width 0.15s;";
    el.appendChild(fill);
    container.appendChild(el);

    function update(health) {
        fill.style.width = `${health}%`;
    }
    function show() { el.style.display = "block"; }
    function hide() { el.style.display = "none"; }
    function dispose() { if (el.parentNode) el.remove(); }

    return { el, update, show, hide, dispose };
}

export function createAmmoDisplay(container) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;bottom:24px;right:24px;color:white;font-family:Inter,sans-serif;font-size:18px;font-weight:bold;z-index:150;display:none;text-shadow:1px 1px 2px rgba(0,0,0,0.8);";
    container.appendChild(el);

    function update(ammo, magazineSize, reloading) {
        el.textContent = reloading ? "RELOADING" : `${ammo} / ${magazineSize}`;
    }
    function show() { el.style.display = "block"; }
    function hide() { el.style.display = "none"; }
    function dispose() { if (el.parentNode) el.remove(); }

    return { el, update, show, hide, dispose };
}

export function createDeathOverlay(container) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(180,0,0,0.4);display:none;z-index:160;justify-content:center;align-items:center;flex-direction:column;";
    const text = document.createElement("div");
    text.style.cssText = "color:white;font-family:MicroExtend,sans-serif;font-size:64px;text-shadow:2px 2px 8px rgba(0,0,0,0.8);";
    text.textContent = "DEAD";
    el.appendChild(text);
    container.appendChild(el);

    function show() { el.style.display = "flex"; }
    function hide() { el.style.display = "none"; }
    function dispose() { if (el.parentNode) el.remove(); }

    return { el, show, hide, dispose };
}

export function createWeaponWheel(container) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;pointer-events:none;opacity:0;transition:opacity 0.3s;";
    const WHEEL_SLOTS = ["Fists", "Glock 17", "Locked", "Locked", "Locked"];
    let wheelTimeout = null;

    function build(slot) {
        const size = 240;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", size);
        svg.setAttribute("height", size);
        svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
        el.innerHTML = "";
        el.appendChild(svg);

        const cx = size / 2, cy = size / 2;
        const inner = 50, outer = 110;
        const gap = 4 * Math.PI / 180;
        const segAngle = (2 * Math.PI / 5);

        for (let i = 0; i < 5; i++) {
            const startAngle = i * segAngle - Math.PI / 2 + gap / 2;
            const endAngle = (i + 1) * segAngle - Math.PI / 2 - gap / 2;
            const selected = i === slot;
            const locked = i >= 2;

            const x1i = cx + inner * Math.cos(startAngle);
            const y1i = cy + inner * Math.sin(startAngle);
            const x1o = cx + outer * Math.cos(startAngle);
            const y1o = cy + outer * Math.sin(startAngle);
            const x2i = cx + inner * Math.cos(endAngle);
            const y2i = cy + inner * Math.sin(endAngle);
            const x2o = cx + outer * Math.cos(endAngle);
            const y2o = cy + outer * Math.sin(endAngle);

            const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const d = `M ${x1i} ${y1i} L ${x1o} ${y1o} A ${outer} ${outer} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x2i} ${y2i} A ${inner} ${inner} 0 ${largeArc} 0 ${x1i} ${y1i} Z`;
            path.setAttribute("d", d);
            path.setAttribute("fill", selected ? "rgba(0,200,0,0.4)" : locked ? "rgba(60,60,60,0.6)" : "rgba(40,40,40,0.6)");
            path.setAttribute("stroke", selected ? "#00ff00" : locked ? "#444" : "#888");
            path.setAttribute("stroke-width", selected ? "2" : "1");
            svg.appendChild(path);

            // Label
            const midAngle = (startAngle + endAngle) / 2;
            const labelR = (inner + outer) / 2;
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", cx + labelR * Math.cos(midAngle));
            text.setAttribute("y", cy + labelR * Math.sin(midAngle));
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("dominant-baseline", "middle");
            text.setAttribute("fill", locked ? "#666" : "white");
            text.setAttribute("font-size", "11");
            text.setAttribute("font-family", "Inter, sans-serif");
            text.textContent = WHEEL_SLOTS[i];
            svg.appendChild(text);
        }
    }

    function show() {
        el.style.opacity = "1";
        clearTimeout(wheelTimeout);
        wheelTimeout = setTimeout(() => { el.style.opacity = "0"; }, 1500);
    }

    function dispose() {
        clearTimeout(wheelTimeout);
        if (el.parentNode) el.remove();
    }

    container.appendChild(el);
    return { el, build, show, dispose };
}

export function createLoadingOverlay(container) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:300;pointer-events:none;";
    const text = document.createElement("div");
    text.style.cssText = "color:rgba(255,255,255,0.7);font-family:MicroExtend,sans-serif;font-size:18px;letter-spacing:4px;";
    text.textContent = "CONNECTING";
    el.appendChild(text);
    el.style.display = "none";
    container.appendChild(el);

    function show() { el.style.display = "flex"; }
    function hide() { el.style.display = "none"; }
    function dispose() { if (el.parentNode) el.remove(); }

    return { el, show, hide, dispose };
}
