const mqtt=require('mqtt');
const client=mqtt.connect('mqtt://localhost:1883');
client.on('connect',()=>console.log('MQTT Connected'));
module.exports=client;
