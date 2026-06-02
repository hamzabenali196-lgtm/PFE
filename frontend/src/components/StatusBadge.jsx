import { Radio, RadioReceiver, WifiOff } from 'lucide-react';

export default function StatusBadge({ socketConnected, mqttConnected }) {
  const online = socketConnected && mqttConnected;
  const label = online ? 'Online' : socketConnected ? 'MQTT offline' : 'Backend offline';
  const Icon = online ? Radio : socketConnected ? RadioReceiver : WifiOff;

  return (
    <div className={`status-badge ${online ? 'online' : 'offline'}`}>
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
