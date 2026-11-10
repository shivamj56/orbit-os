# Xiaomi TV A Pro (MiTV-AXFU0)

The first TV Orbit OS ran on, in daily use since November 2026.

| | |
|---|---|
| Model code | MiTV-AXFU0, codename `arctictale` |
| System | Google TV 14 (Android 14, SDK 34), firmware V816.0.26.9.16 |
| Panel | 1280 x 720 at 60 Hz |
| Chip | 4 x Cortex-A53, Mali-G31 GPU, a low-memory device (`ro.config.low_ram=true`) |
| Remote | Xiaomi RC over Bluetooth; Google's remote service passes it on as the input device `virtual-remote` |

## In this folder

| File | What it is |
|---|---|
| [`debloat.txt`](debloat.txt) | The 32 packages switched off on this TV, grouped, with the reason for each group |
| [`theme/config.json`](theme/config.json) | The look: black, one frosted row, icon-only buttons, the helper's key filter on |

## What to know about this TV

- **setupwraith and launcherx go off together.** With the stock launcher off and Google's setup app still on, Home
  crash-loops about every 60 seconds. If the TV was set up from the Google Home app, setupwraith may own the Wi-Fi
  network: check `dumpsys wifi | grep -o 'cname=[^ ]*'` first, and if it does, forget the network and join it
  again from Settings.
- **Keep `com.mitv.overseaservice`**: without it the remote loses its pairing after standby.
- **Keep `partnercustomizer`** if you use the remote's shortcut buttons.
- **Keep the gallery and video player** if you play films from a USB drive.
- **The YouTube, Settings and Apps buttons** need the helper service once the stock launcher is off; Netflix,
  Prime Video, Input and voice work without it. The microphone sends no key at all: Google's assistant answers it
  directly.
- **No picture-in-picture, no blur behind windows.** Orbit's video shelf and its blurred backdrops are drawn by
  Orbit itself.
- **Screenshots show video as grey.** The video layer cannot be captured; Netflix and Prime Video hide their
  whole window.
- **The boot logos stay.** The bootloader is locked (`ro.boot.flash.locked=1`), so the Mi and Google logos cannot
  be replaced; Orbit's film plays when Home starts, about 39 seconds after power-on.
- **Wait 20 seconds before a restart.** A plain `reboot` loses what the package manager wrote in the last ten
  seconds or so, switch-offs included.

## Measured on this TV

| What | Result |
|---|---|
| Opening the Control Center and moving in it | 60 frames a second, no missed frames |
| Scrolling the gallery | No janky frames in 400, about 11 ms a frame |
| Orbit Live TV playing a channel | 54 to 62 MB of memory |
| Home on screen after power-on | About 39 seconds, the boot film included |
