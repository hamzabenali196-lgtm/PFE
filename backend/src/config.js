import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  frontendOrigin: process.env.FRONTEND_ORIGIN || '*',
  micDevice: process.env.MIC_DEVICE || 'plughw:2,0'
};
