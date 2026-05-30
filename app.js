import { GoogleGenAI, Modality } from "@google/genai"
import { configDotenv } from "dotenv"
import { WebSocketServer } from "ws"
configDotenv()

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY})
const model = 'gemini-3.1-flash-live-preview'
const config = { responseModalities: [Modality.AUDIO] }
const wss = new WebSocketServer({ port: 8080 })

wss.on('connection', async (clientWs) => {
    const session = await ai.live.connect({
        model,
        callbacks: {
            onopen: function () {
                console.debug("Session OPEN")
            },
            onmessage: function (message) {
                const content = message.serverContent

                // RECIEVE AUDIO
                if (content?.modelTurn?.parts) {
                    for (const part of content.modelTurn.parts) {
                        if (part.inlineData) {
                            const audioData = part.inlineData.data
                            if (clientWs.readyState === clientWs.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'audio', data: audioData}))
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