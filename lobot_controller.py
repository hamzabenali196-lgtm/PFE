import time

import serial


class LobotServo:
    def __init__(self, id: int, position: int):
        self.id = id
        self.position = position


class LobotController:
    FRAME_HEADER = 0x55
    CMD_SERVO_MOVE = 0x03
    CMD_ACTION_GROUP_STOP = 0x07

    def __init__(self, port: str = "/dev/ttyAMA0", baud: int = 9600, timeout: float = 0.1):
        self.ser = serial.Serial(port, baud, timeout=timeout)
        time.sleep(0.5)

    def move_servos(self, servos: list[LobotServo], time_ms: int) -> None:
        num = len(servos)
        if num < 1 or num > 32 or time_ms <= 0:
            return

        buf = bytearray()
        buf.append(self.FRAME_HEADER)
        buf.append(self.FRAME_HEADER)
        buf.append(num * 3 + 5)
        buf.append(self.CMD_SERVO_MOVE)
        buf.append(num)
        buf.append(time_ms & 0xFF)
        buf.append((time_ms >> 8) & 0xFF)

        for servo in servos:
            buf.append(servo.id)
            buf.append(servo.position & 0xFF)
            buf.append((servo.position >> 8) & 0xFF)

        self.ser.write(buf)

    def stop_action_group(self) -> None:
        buf = bytearray([
            self.FRAME_HEADER,
            self.FRAME_HEADER,
            0x02,
            self.CMD_ACTION_GROUP_STOP,
        ])
        self.ser.write(buf)

    def close(self) -> None:
        self.ser.close()
