import mqtt from 'mqtt'
import { configDotenv } from 'dotenv'
configDotenv()

const client = mqtt.connect(process.env.MQTT_BROKER_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    port: process.env.MQTT_PORT
})

export function publish(topic, state) {
    client.publish(topic, state)
    console.log(`[MQTT] Published to ${topic} with state ${state}`)
}

client.on('connect', () => {
    console.log('[MQTT] Connected')
    publish('home/living-room/lamp-main', 'ON')
})

client.on('error', (err) => console.error('[MQTT] Error: ', err))
