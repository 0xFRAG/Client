use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Mutex};
use wtransport::endpoint::endpoint_side::Client;
use wtransport::{ClientConfig, Connection, Endpoint, VarInt};

// --- Shared state ---

pub(crate) struct InputState {
    pub keys: u8,
    pub yaw: f32,
    pub pitch: f32,
    pub weapon_slot: u8,
    pub seq: u32,
}

pub(crate) struct TransportState {
    pub connection: Option<Connection>,
    pub input: InputState,
    pub shutdown_tx: Option<watch::Sender<bool>>,
    pub bidi_writer: Option<Arc<Mutex<wtransport::SendStream>>>,
}

impl Default for TransportState {
    fn default() -> Self {
        Self {
            connection: None,
            input: InputState {
                keys: 0,
                yaw: 0.0,
                pitch: 0.0,
                weapon_slot: 0,
                seq: 0,
            },
            shutdown_tx: None,
            bidi_writer: None,
        }
    }
}

pub(crate) type SharedState = Arc<Mutex<TransportState>>;

// --- Tauri event payloads ---

#[derive(Debug, Clone, Serialize)]
pub(crate) struct WorldStatePayload {
    pub tick: u64,
    pub players: Vec<PlayerPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerPayload {
    pub id: u64,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub rot: f32,
    pub vy: f32,
    pub pitch: f32,
    pub sneaking: bool,
    pub shooting: bool,
    pub weapon_slot: u8,
    pub dead: bool,
    pub reloading: bool,
    pub health: u8,
    pub ammo: u8,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ConnectResult {
    pub player_id: u64,
    pub map_json: serde_json::Value,
}

// --- Tauri commands ---

#[tauri::command]
pub(crate) async fn connect(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    token: String,
    server: String,
    stream_host: String,
    stream_port: u16,
) -> Result<ConnectResult, String> {
    // Disconnect any existing connection first
    disconnect_inner(&state).await;

    let url = format!(
        "https://{}:{}/?token={}&server={}",
        stream_host, stream_port, token, server
    );

    // Build WT client endpoint
    let config = ClientConfig::builder()
        .with_bind_default()
        .with_native_certs()
        .build();

    let endpoint = Endpoint::<Client>::client(config).map_err(|e| e.to_string())?;

    let conn = endpoint
        .connect(&url)
        .await
        .map_err(|e| format!("WT connect failed: {e}"))?;

    // Read uni stream: player_id\n{map_json}
    let mut uni = conn
        .accept_uni()
        .await
        .map_err(|e| format!("Failed to accept uni stream: {e}"))?;

    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        match uni.read(&mut tmp).await {
            Ok(Some(n)) => buf.extend_from_slice(&tmp[..n]),
            Ok(None) => break,
            Err(e) => return Err(format!("Uni stream read error: {e}")),
        }
    }

    let raw = String::from_utf8(buf).map_err(|e| format!("Invalid UTF-8: {e}"))?;
    let nl_idx = raw.find('\n').ok_or("Missing newline in uni stream data")?;
    let player_id: u64 = raw[..nl_idx]
        .parse()
        .map_err(|e| format!("Invalid player_id: {e}"))?;
    let map_json: serde_json::Value =
        serde_json::from_str(&raw[nl_idx + 1..]).map_err(|e| format!("Invalid map JSON: {e}"))?;

    // Accept server-initiated bidi stream
    let (send_stream, recv_stream) = conn
        .accept_bi()
        .await
        .map_err(|e| format!("Failed to accept bidi stream: {e}"))?;

    let bidi_writer = Arc::new(Mutex::new(send_stream));

    // Setup shutdown signal
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Store state
    {
        let mut st = state.lock().await;
        st.connection = Some(conn.clone());
        st.shutdown_tx = Some(shutdown_tx);
        st.bidi_writer = Some(bidi_writer.clone());
        st.input.seq = 0;
    }

    // Spawn datagram reader task
    let app_dg = app.clone();
    let mut shutdown_dg = shutdown_rx.clone();
    let conn_dg = conn.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                _ = shutdown_dg.changed() => break,
                result = conn_dg.receive_datagram() => {
                    match result {
                        Ok(datagram) => {
                            if let Some(ws) = parse_world_state(&datagram) {
                                let _ = app_dg.emit("world-state", ws);
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    });

    // Spawn bidi stream reader task (NDJSON events)
    let app_ev = app.clone();
    let mut shutdown_ev = shutdown_rx.clone();
    tokio::spawn(async move {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        let mut recv = recv_stream;
        loop {
            tokio::select! {
                biased;
                _ = shutdown_ev.changed() => break,
                result = recv.read(&mut tmp) => {
                    match result {
                        Ok(Some(n)) => {
                            buf.extend_from_slice(&tmp[..n]);
                            // Process complete NDJSON lines
                            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                                let line = &buf[..nl];
                                if !line.is_empty() && let Ok(msg) = serde_json::from_slice::<serde_json::Value>(line) {
                                    let _ = app_ev.emit("server-event", msg);
                                }
                                buf.drain(..=nl);
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
            }
        }
        let _ = app_ev.emit("transport-closed", serde_json::json!({}));
    });

    // Spawn input sender task (60Hz)
    let state_input = Arc::clone(&*state);
    let mut shutdown_input = shutdown_rx.clone();
    let conn_input = conn.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_micros(16_667));
        loop {
            tokio::select! {
                biased;
                _ = shutdown_input.changed() => break,
                _ = interval.tick() => {
                    let packet = {
                        let mut st = state_input.lock().await;
                        let inp = &mut st.input;
                        let mut pkt = [0u8; 14];
                        pkt[0..4].copy_from_slice(&inp.seq.to_le_bytes());
                        pkt[4] = inp.keys;
                        pkt[5..9].copy_from_slice(&inp.yaw.to_le_bytes());
                        pkt[9..13].copy_from_slice(&inp.pitch.to_le_bytes());
                        pkt[13] = inp.weapon_slot;
                        inp.seq = inp.seq.wrapping_add(1);
                        pkt
                    };
                    if conn_input.send_datagram(packet).is_err() {
                        break;
                    }
                }
            }
        }
    });

    Ok(ConnectResult {
        player_id,
        map_json,
    })
}

#[tauri::command]
pub(crate) async fn disconnect(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    disconnect_inner(&state).await;
    Ok(())
}

async fn disconnect_inner(state: &SharedState) {
    let mut st = state.lock().await;
    // Signal all background tasks to stop
    if let Some(tx) = st.shutdown_tx.take() {
        let _ = tx.send(true);
    }
    // Close the connection
    if let Some(conn) = st.connection.take() {
        conn.close(VarInt::from(0u32), b"client disconnect");
    }
    st.bidi_writer = None;
}

#[tauri::command]
pub(crate) async fn set_input(
    state: tauri::State<'_, SharedState>,
    keys: u8,
    yaw: f32,
    pitch: f32,
    fire: bool,
    weapon_slot: u8,
) -> Result<(), String> {
    let mut st = state.lock().await;
    let mut key_bits = keys & 0x3F; // lower 6 bits: w,a,s,d,space,shift
    if fire {
        key_bits |= 64;
    }
    st.input.keys = key_bits;
    st.input.yaw = yaw;
    st.input.pitch = pitch;
    st.input.weapon_slot = weapon_slot;
    Ok(())
}

#[tauri::command]
pub(crate) async fn send_chat(
    state: tauri::State<'_, SharedState>,
    text: String,
) -> Result<(), String> {
    let st = state.lock().await;
    if let Some(writer) = &st.bidi_writer {
        let msg = serde_json::json!({"type": "chat", "text": text});
        let line = format!("{}\n", msg);
        let mut w = writer.lock().await;
        w.write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to send chat: {e}"))?;
    }
    Ok(())
}

// --- Binary world state parser ---

fn parse_world_state(data: &[u8]) -> Option<WorldStatePayload> {
    if data.len() < 9 {
        return None;
    }
    let tick = u64::from_le_bytes(data[0..8].try_into().ok()?);
    let count = data[8] as usize;
    let player_size = 35;
    if data.len() < 9 + count * player_size {
        return None;
    }
    let mut players = Vec::with_capacity(count);
    for i in 0..count {
        let off = 9 + i * player_size;
        let id = u64::from_le_bytes(data[off..off + 8].try_into().ok()?);
        let x = f32::from_le_bytes(data[off + 8..off + 12].try_into().ok()?);
        let y = f32::from_le_bytes(data[off + 12..off + 16].try_into().ok()?);
        let z = f32::from_le_bytes(data[off + 16..off + 20].try_into().ok()?);
        let rot = f32::from_le_bytes(data[off + 20..off + 24].try_into().ok()?);
        let vy = f32::from_le_bytes(data[off + 24..off + 28].try_into().ok()?);
        let pitch = f32::from_le_bytes(data[off + 28..off + 32].try_into().ok()?);
        let flags = data[off + 32];
        let health = data[off + 33];
        let ammo = data[off + 34];

        players.push(PlayerPayload {
            id,
            x,
            y,
            z,
            rot,
            vy,
            pitch,
            sneaking: (flags & 1) != 0,
            shooting: (flags & 2) != 0,
            weapon_slot: (flags >> 2) & 7,
            dead: (flags & 32) != 0,
            reloading: (flags & 64) != 0,
            health,
            ammo,
        });
    }
    Some(WorldStatePayload { tick, players })
}
