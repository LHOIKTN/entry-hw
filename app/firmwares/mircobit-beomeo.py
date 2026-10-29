# Add your Python code here. E.g.
from microbit import *
import audio
import music
import radio
import machine
import utime

def write_angle(pin, degrees):
    pin.set_analog_period(20)
    degrees = degrees % 360
    us = 600 + 1800 * degrees // 180
    us = min(2400, max(600, us))
    duty = round(us * 1024 * 50 // 1000000)
    pin.write_analog(duty)
    sleep(600)
    pin.write_digital(0)  # turn the pin off

def resetPins():
    pin0.write_digital(0)
    pin1.write_digital(0)
    pin2.write_digital(0)  

presetMelody = [
    music.DADADADUM,
    music.ENTERTAINER,
    music.PRELUDE,
    music.ODE,
    music.NYAN,
    music.RINGTONE,
    music.FUNK,
    music.BLUES,
    music.BIRTHDAY,
    music.WEDDING,
    music.FUNERAL,
    music.PUNCHLINE,
    music.PYTHON,
    music.BADDY,
    music.CHASE,
    music.BA_DING,
    music.WAWAWAWAA,
    music.JUMP_UP,
    music.JUMP_DOWN,
    music.POWER_UP,
    music.POWER_DOWN,
    # 21개, index 20
    Sound.GIGGLE,
    Sound.HAPPY,
    Sound.HELLO,
    Sound.MYSTERIOUS,
    Sound.SAD,
    Sound.SLIDE,
    Sound.SOARING,
    Sound.SPRING,
    Sound.TWINKLE,
    Sound.YAWN,
]


analogPins = {0: pin0, 1: pin1, 2: pin2, 3: pin3, 4: pin4, 10: pin10}

# GPIO pins P0-P16. Some are shared with display/buttons/SPI.
# Analog ADC is restricted to the analogPins dictionary above.
digitalPins = {
    0: pin0, 1: pin1, 2: pin2, 3: pin3, 4: pin4,
    5: pin5, 6: pin6, 7: pin7, 8: pin8, 9: pin9,
    10: pin10, 11: pin11, 12: pin12, 13: pin13,
    14: pin14, 15: pin15, 16: pin16,
    19: pin19, 20: pin20,
}

# Pins available for TRIG/ECHO (including pins used for analog I/O).
ultrasonicPins = dict(digitalPins)

def read_ultrasonic_cm(trig_number, echo_number):
    if trig_number == echo_number:
        return -1
    trig = ultrasonicPins[trig_number]
    echo = ultrasonicPins[echo_number]
    trig.write_digital(0)
    utime.sleep_us(2)
    trig.write_digital(1)
    utime.sleep_us(10)
    trig.write_digital(0)
    # Measure ECHO high pulse locally, avoiding USB/serial timing errors.
    duration = machine.time_pulse_us(echo, 1, 30000)
    if duration < 0:
        return -1
    return round(duration / 58.0, 1)

uart.init(baudrate=115200, bits=8, parity=None, stop=1)
version = '2.0 20230216'

req = ""
while True:
    # uart.any() returns a byte count, not necessarily the boolean True.
    if not uart.any():
        continue
    data = uart.read(1)
    if not data:
        continue
    code = data[0]
    if code == 13:  # Ignore CR in CRLF.
        continue
    if code != 10:
        # Entry-HW protocol commands are ASCII. Ignore terminal escape/non-ASCII bytes.
        if 32 <= code <= 126 and len(req) < 128:
            req += chr(code)
        continue
    # Process only complete newline-terminated commands.
    if len(req) < 4:
        req = ""
        continue

    parsedData = req.split(";")
    command = parsedData[0]
    args = [x.rstrip() for x in parsedData[1:]]

    rtn = command + ";"

    if command =='localdata':
        rtn+= version
        if button_a.is_pressed() or button_b.is_pressed():
            rtn += ":btn:"
            if button_a.is_pressed() and button_b.is_pressed():
                rtn += "3"
            elif button_a.is_pressed():
                rtn += "1"
            elif button_b.is_pressed():
                rtn += "2"
            else:
                rtn += "0"

    elif command == "custom-image":
        display.clear()
        display.show(Image(args[0].replace("localdata", "", -1)))    

    elif command == "print":
        display.scroll(args[0])

    elif command == "get-btn":
        if button_a.is_pressed() and button_b.is_pressed():
            rtn += "3"
        elif button_a.is_pressed():
            rtn += "1"
        elif button_b.is_pressed():
            rtn += "2"
        else:
            rtn += "0"

    elif command == "get-touch":
        if pin_logo.is_touched():
            rtn += "1"
        else:
            rtn += "0"

    elif command == "get-acc":
        if args[0] == "x":
            rtn += str(accelerometer.get_x())
        elif args[0] == "y":
            rtn += str(accelerometer.get_y())
        elif args[0] == "z":
            rtn += str(accelerometer.get_z())
        elif args[0] == "mag":
            rtn += str(
                (
                    accelerometer.get_x() ** 2
                    + accelerometer.get_y() ** 2
                    + accelerometer.get_z() ** 2
                )
                ** 0.5
            )

    elif command == "get-gesture":
        rtn += str(accelerometer.current_gesture())

    elif command == "get-analog":
        rtn += str(analogPins[int(args[0])].read_analog())

    elif command == "set-analog":
        analogPins[int(args[0])].write_analog(int(args[1]))

    elif command == "get-ultrasonic":
        try:
            rtn += str(read_ultrasonic_cm(int(args[0]), int(args[1])))
        except (ValueError, IndexError, KeyError):
            rtn += "-1"

    elif command == "get-digital":
        rtn += str(digitalPins[int(args[0])].read_digital())

    elif command == "set-digital":
        digitalPins[int(args[0])].write_digital(int(args[1]))

    elif command == "set-pixel":
        display.set_pixel(int(args[0]), int(args[1]), int(args[2]))

    elif command == "get-pixel":
        rtn += str(display.get_pixel(int(args[0]), int(args[1])))

    elif command == "display-clear":
        display.clear()

    elif command == "get-display":
        if display.is_on():
            rtn += "1"
        else:
            rtn += "0"

    elif command == "display-on":
        display.on()

    elif command == "display-off":
        display.off()

    elif command == "direction":
        if not compass.is_calibrated():
            compass.calibrate()

        rtn += str(compass.heading())

    elif command == "field-strength":
        if not compass.is_calibrated():
            compass.calibrate()

        if args[0] == "x":
            rtn += str(compass.get_x())
        elif args[0] == "y":
            rtn += str(compass.get_y())
        elif args[0] == "z":
            rtn += str(compass.get_z())
        elif args[0] == "mag":
            rtn += str(compass.get_field_strength())

    elif command == "light-level":
        rtn += str(display.read_light_level())

    elif command == "sound-level":
        rtn += str(microphone.sound_level())

    elif command == "temperature":
        rtn += str(temperature())

    elif command == "speaker-on":
        speaker.on()

    elif command == "speaker-off":
        speaker.off()

    elif command == "pre-sound":
        audio.play(presetMelody[int(args[0])], wait=True)
        sleep(10)

    elif command == "pre-melody":
        music.play(presetMelody[int(args[0])], wait=True)
        sleep(10)

    # format of noteScale+octave:duration, eg. c1:4
    elif command == "play-tone":
        music.play(args[0], wait=True)
        sleep(10)

    elif command == "change-tempo":
        music.set_tempo(ticks=int(args[0]), bpm=int(args[1]))

    elif command == "radio-on":
        radio.on()

    elif command == "radio-off":
        radio.off()

    elif command == "radio-setting":
        radio.config(length=64, channel=int(args[0]))

    elif command == "radio-send":
        radio.send(args[0])

    elif command == "radio-receive":
        rtn += str(radio.receive())

    elif command == "servo-write":
        write_angle(analogPins[int(args[0])], int(args[1]))

    elif command == "write-period":
        analogPins[int(args[0])].set_analog_period(int(args[1]))

    elif command == "write-micro-period":
        analogPins[int(args[0])].set_analog_period_microseconds(int(args[1]))

    elif command == "reset":
        display.clear()
        music.reset()
        radio.reset()
        resetPins()

    sleep(10)
    uart.write(rtn + "\r\n")
    req = ""
    # print(rtn + "\r\n")
