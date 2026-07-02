# -*- coding: utf-8 -*-
"""Toggle pins step by step. Create each pin ONCE, then reuse a/b/c."""
from gpiozero import DigitalOutputDevice
PINS = [17, 27, 21, 22, 24, 20]

# right

a = DigitalOutputDevice(20) #pwm
b = DigitalOutputDevice(24)
c = DigitalOutputDevice(22)

# step 1
a.on()
b.on()
c.off()
input("step 1 — press Enter for next...")

# step 2
a.on()
b.off()
c.on()
input("step 2 — press Enter for next...")

# step 3
a.off()
b.on()
c.off()
input("step 3 — press Enter to finish...")

a.close()
b.close()
c.close()


# left

a = DigitalOutputDevice(17) #pwm
b = DigitalOutputDevice(27)
c = DigitalOutputDevice(21)

# step 1
a.on()
b.on()
c.off()
input("step 1 — press Enter for next...")

# step 2
a.on()
b.off()
c.on()
input("step 2 — press Enter for next...")

# step 3
a.off()
b.on()
c.off()
input("step 3 — press Enter to finish...")

a.close()
b.close()
c.close()
