import { GoogleGenAI, Modality } from "@google/genai"
import { configDotenv } from "dotenv"
import { WebSocketServer } from "ws"
import { publish } from './mqtt.js'
configDotenv()

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY})
const model = 'gemini-3.1-flash-live-preview'
const wss = new WebSocketServer({ port: process.env.SERVER_PORT || process.env.PORT || 8080 })
const config = { 
    responseModalities: [Modality.AUDIO],
    systemInstruction: {
        parts: [{
            text: `
Kamu adalah asisten rumah pintar bernama amba dengan nama lengkap ambatukam. kamu adalah AI SmartHome Assistant ciptaan Juan, kamu tinggal di keluarga prawoko, yang terdiri dari ayah, ibu, dan 2 anak. Kamu tinggal di rumah yang berada di Dusun Midodaren, Desa Dawuhan, Kecamatan Kademangan, Kabupaten Blitar, Jawa Timur, Indonesia. 

Bahasa utama yang digunakan oleh orang rumah: bahasa jawa dan indonesia.

Nama panggilan anggota keluarga: 
- ayah: Pak Woko
- ibu: Bu Muda
- anak pertama: Mas Juan
- anak kedua: Dek Nevan

Gaya bicara:
- Santai, friendly, tidak kaku
- Boleh pakai bahasa campur Indonesia-Inggris (casual)
- Jawab singkat dan to the point, tidak bertele-tele
- Boleh sedikit bercanda tapi tetap helpful

Ruangan dan perangkat yang tersedia HANYA berikut ini:
- home/living-room/lamp-main
- home/living-room/fan
- home/bedroom-nevan/lamp-main
- home/bedroom-nevan/fan
- home/bedroom-juan/lamp-main
- home/bedroom-juan/lamp-desk
- home/kitchen/lamp-main
- home/terrace/lamp-main

Jika user meminta perangkat atau ruangan yang tidak ada, tolak dengan sopan 
dan informasikan perangkat yang tersedia. Jangan mengarang topic MQTT di luar daftar.
Jika pengguna mengakhiri percakapan (misalnya mengucapkan terima kasih, pamit, atau selamat tinggal), panggil fungsi end_session.`
        }]
    },
    tools: [{
        functionDeclarations: [{
            name: 'control_device',
            description: 'Mengontrol perangkat rumah pintar seperti lampu, kipas, dll.',
            parameters: {
                type: 'object',
                properties: {
                    topic: {
                        type: 'string',
                        description: 'MQTT topic perangkat, contoh: home/living-room/lamp-main, home/bedroom01/fan, home/kitchen/lamp-main'
                    },
                    state: {
                        type: 'string',
                        enum: ['ON', 'OFF'],
                        description: 'Status Perangkat'
                    }
                },
                required: ['topic', 'state']
            }
        }, {
            name: 'end_session',
            description: 'Mengakhiri sesi percakapan. Panggil fungsi ini jika pengguna menyatakan percakapan selesai, mengucapkan terima kasih, atau pamit.'
        }]
    }]
}

wss.on('connection', async (clientWs) => {
    const session = await ai.live.connect({
        model,
        callbacks: {
            onopen: function () {
                console.debug("Session OPEN")
            },
            onmessage: function (message) {
                const content = message.serverContent

                if (message.toolCall) {
                    const functionCalls = message.toolCall.functionCalls;
                    const functionResponses = [];

                    for (const call of functionCalls) {
                        if (call.name === 'control_device') {
                            const { topic, state } = call.args;

                            console.log(`[TOOL CALL] ${call.name}, > ${topic} : ${state}`);
                            publish(topic, state);

                            functionResponses.push({
                                id: call.id,
                                name: call.name,
                                response: { output: `${topic} is now ${state}`}
                            });
                        } else if (call.name === 'end_session') {
                            console.log(`[TOOL CALL] ${call.name}`);
                            if (clientWs.readyState === clientWs.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'session_end' }));
                            }
                            functionResponses.push({
                                id: call.id,
                                name: call.name,
                                response: { output: 'Session ended' }
                            });
                        }
                    }

                    // Kirim semua toolResponse balik ke Gemini sekaligus
                    if (functionResponses.length > 0) {
                        session.sendToolResponse({
                            functionResponses: functionResponses
                        });
                    }
                }

                // RECIEVE AUDIO
                if (content?.modelTurn?.parts) {
                    for (const part of content.modelTurn.parts) {
                        if (part.inlineData) {
                            const audioData = part.inlineData.data; // Base64 dari Gemini
                            if (clientWs.readyState === clientWs.OPEN) {
                                // ESP32 RAM-nya kecil, jadi kita tidak bisa kirim base64 raksasa sekaligus.
                                // Kita ubah Base64 ke Buffer biner, lalu potong-potong jadi ukuran kecil (4KB)
                                const pcmBuffer = Buffer.from(audioData, 'base64');
                                const CHUNK_SIZE = 4096; // 4KB per potongan
                                
                                for (let i = 0; i < pcmBuffer.length; i += CHUNK_SIZE) {
                                    const chunk = pcmBuffer.slice(i, i + CHUNK_SIZE);
                                    const chunkBase64 = chunk.toString('base64');
                                    clientWs.send(JSON.stringify({ type: 'audio', data: chunkBase64 }));
                                }
                            }
                        }
                    }
                }

                // TRANSCRIPT TO TEXT
                if (content?.inputTranscription) {
                    console.log('User:', content.inputTranscription.text)
                }
                if (content?.outputTranscription) {
                    console.log('Gemini:', content.outputTranscription.text)
                }
            },
            onerror: function (err) {
                console.debug("Session Error: ", err.message)
            },
            onclose: function (err) {
                console.debug("Session Closed: ", err.reason)
            },
        },
        config: config
    })

    clientWs.on('message', (data) => {
        const msg = JSON.parse(data)
        session.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' }
        })
    })

    clientWs.on('close', () => {
        session.close()
    })
})