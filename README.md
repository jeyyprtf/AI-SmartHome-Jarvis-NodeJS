# AI SmartHome Jarvis — Backend

Backend WebSocket server untuk project SmartHome IoT yang mengintegrasikan **Google Gemini Live API** sebagai AI voice assistant dengan kontrol perangkat rumah via **MQTT**.

---

## Cara Kerja

```
ESP32 / Client
     │
     │  WebSocket (raw PCM audio base64, 16kHz)
     ▼
[Node.js Backend :8080]
     │
     ├──► Google Gemini Live API (audio stream)
     │         │
     │         ├── AI bicara → PCM audio response → dipotong 4KB chunks → dikirim balik ke client
     │         └── Function Call: control_device → publish MQTT
     │
     └──► MQTT Broker → ESP32 / relay perangkat
```

**Flow lengkapnya:**
1. Client (ESP32 atau browser) konek ke WebSocket `ws://server:8080`
2. Client kirim audio PCM 16kHz dalam format base64 JSON: `{ "data": "<base64>" }`
3. Backend forward ke Gemini Live API secara realtime
4. Gemini memproses audio dan merespons dengan:
   - **Audio response** → di-decode dari base64, dipotong jadi chunk 4KB, dikirim balik ke client sebagai `{ "type": "audio", "data": "<base64>" }`
   - **Function call** `control_device` → backend publish ke MQTT broker untuk kontrol perangkat fisik
5. Setiap koneksi WebSocket baru membuat **satu sesi Gemini** tersendiri (session per connection)

---

## Prerequisites

| Requirement | Versi Minimum |
|---|---|
| Node.js | v18+ (ES Modules support) |
| npm | v8+ |
| Google Gemini API Key | dengan akses ke `gemini-3.1-flash-live-preview` |
| MQTT Broker | Mosquitto / HiveMQ / broker apapun yang support MQTT v3/v5 |

---

## Struktur File

```
.
├── app.js          # Entry point — WebSocket server + Gemini Live session handler
├── mqtt.js         # MQTT client + fungsi publish
├── saveAsWav.js    # Utility: convert PCM buffer ke file .wav (debug only)
├── package.json
└── .env            # Konfigurasi environment (JANGAN di-commit)
```

---

## Setup & Deploy

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd AI-SmartHome-Jarvis-NodeJS
npm install
```

### 2. Buat File `.env`

Buat file `.env` di root project:

```env
# Google Gemini API
API_KEY=your_gemini_api_key_here

# MQTT Broker
MQTT_BROKER_URL=mqtt://your-broker-host
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password
MQTT_PORT=1883
```

> **Catatan:** `MQTT_BROKER_URL` pakai protokol `mqtt://` untuk plaintext atau `mqtts://` untuk TLS.

### 3. Jalankan Server

```bash
node app.js
```

Server akan listen di **port 8080**.

Output normal saat startup:

```
[MQTT] Connected
```

Output saat ada client konek:

```
Session OPEN
User: nyalain lampu ruang tamu
[TOOL CALL] control_device, > home/living-room/lamp-main : ON
[MQTT] Published to home/living-room/lamp-main with state ON
Gemini: Oke, lampu ruang tamu sudah nyala!
```

---

## Deploy ke Server (Production)

### Menggunakan PM2 (Recommended)

PM2 menjaga proses tetap hidup dan auto-restart jika crash.

```bash
# Install PM2 global
npm install -g pm2

# Jalankan app
pm2 start app.js --name jarvis-backend

# Auto-start saat server reboot
pm2 startup
pm2 save
```

Perintah PM2 yang berguna:

```bash
pm2 status                  # cek status semua proses
pm2 logs jarvis-backend     # lihat live logs
pm2 restart jarvis-backend  # restart manual
pm2 stop jarvis-backend     # stop proses
```

### Menggunakan systemd (Alternatif)

Buat file `/etc/systemd/system/jarvis-backend.service`:

```ini
[Unit]
Description=AI SmartHome Jarvis Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/AI-SmartHome-Jarvis-NodeJS
ExecStart=/usr/bin/node app.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/path/to/AI-SmartHome-Jarvis-NodeJS/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable jarvis-backend
sudo systemctl start jarvis-backend
sudo systemctl status jarvis-backend
```

---

## WebSocket API

### Endpoint

```
ws://<host>:8080
```

### Client → Server

Kirim audio PCM realtime sebagai JSON:

```json
{
  "data": "<base64-encoded PCM audio>"
}
```

- Format audio: **PCM raw, 16kHz, 16-bit, mono**
- Kirim terus-menerus (streaming) selagi user berbicara

### Server → Client

Respons audio dari Gemini dikirim dalam potongan-potongan (chunks):

```json
{
  "type": "audio",
  "data": "<base64-encoded PCM audio chunk>"
}
```

- Format audio: **PCM raw, 24kHz, 16-bit, mono**
- Ukuran setiap chunk: maks **4096 bytes** (4KB) — dioptimasi untuk RAM ESP32 yang terbatas
- Client harus menggabungkan chunks secara berurutan untuk playback

---

## MQTT Topics & Perangkat

Backend publish ke MQTT broker ketika Gemini memanggil function `control_device`.

| Topic | Perangkat |
|---|---|
| `home/living-room/lamp-main` | Lampu utama ruang tamu |
| `home/living-room/fan` | Kipas ruang tamu |
| `home/bedroom-nevan/lamp-main` | Lampu kamar Nevan |
| `home/bedroom-nevan/fan` | Kipas kamar Nevan |
| `home/bedroom-juan/lamp-main` | Lampu utama kamar Juan |
| `home/bedroom-juan/lamp-desk` | Lampu meja kamar Juan |
| `home/kitchen/lamp-main` | Lampu dapur |
| `home/terrace/lamp-main` | Lampu teras |

**Payload:** `ON` atau `OFF` (plain string, bukan JSON)

---

## Konfigurasi Firewall

Port yang perlu dibuka di server:

| Port | Protokol | Keterangan |
|---|---|---|
| `8080` | TCP | WebSocket client connections |
| `1883` | TCP | MQTT (jika broker di server yang sama) |

Contoh dengan `ufw`:

```bash
sudo ufw allow 8080/tcp
sudo ufw allow 1883/tcp
```

---

## Troubleshooting

**`Session Error: ...` / Gemini tidak merespons**
- Pastikan `API_KEY` di `.env` valid dan punya akses ke model `gemini-3.1-flash-live-preview`
- Cek koneksi internet server ke Google API

**`[MQTT] Error: ...` / perangkat tidak bereaksi**
- Pastikan `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, dan `MQTT_PORT` di `.env` benar
- Cek apakah MQTT broker sedang running: `systemctl status mosquitto`
- Test manual dengan: `mosquitto_pub -h <host> -t home/living-room/lamp-main -m ON`

**Client ESP32 tidak bisa konek WebSocket**
- Pastikan port 8080 tidak diblokir firewall
- Jika pakai reverse proxy (Nginx), pastikan konfigurasi upgrade WebSocket sudah benar (lihat seksi Nginx di bawah)

---

## Opsional: Nginx Reverse Proxy + SSL

Jika ingin expose via HTTPS/WSS (recommended untuk production):

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

Client kemudian konek ke `wss://yourdomain.com` alih-alih `ws://server:8080`.

---

## Tech Stack

| Library | Versi | Fungsi |
|---|---|---|
| `@google/genai` | ^2.7.0 | Gemini Live API client |
| `ws` | ^8.21.0 | WebSocket server |
| `mqtt` | ^5.15.1 | MQTT client |
| `dotenv` | ^17.4.2 | Environment variable loader |
