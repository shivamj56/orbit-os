# The Orbit phone remote, step by step

[Português (Brasil)](phone-remote.pt-BR.md)

This guide is for a TV that already has Orbit OS set up (the Orbit home screen shows when you press Home).

## Before you start

- The phone and the TV are on the **same home Wi-Fi**. A guest network usually blocks phones from reaching the TV.
- The TV is on, or in normal standby.

## 1. Connect the phone to the TV (once)

1. Open **Orbit** on the phone. It looks for your TV on the Wi-Fi.
2. Tap your TV's name in the list. If the list stays empty, type the TV's address (Settings › Network on the TV shows it, for example `192.168.1.20`).
3. The TV shows a **6-digit code** at the top of the Orbit home screen. Type it on the phone.
4. Done. The phone remembers the TV, so next time it connects by itself.

## 2. The remote screen

**The globe** works in two modes. Switch between them with **Focus** and **Cursor** at the top.

- **Focus** (like a normal remote):
  - Roll the globe with your thumb towards a direction to move one step: up, down, left or right.
  - **Tap** the globe for **OK**.
  - **Hold** it for recent apps.
- **Cursor** (like a laptop touchpad, for apps and websites that need a pointer):
  - Glide your finger to move the pointer on the TV.
  - Tap to click.
  - Use two fingers to scroll.

**Under the globe:** **Back**, **Home** and **Recent**.

**The bar at the bottom:**
- Volume down, the level and volume up. Tap the level to mute.
- **Keyboard**: type on the TV from your phone, which is much faster for search.
- **Apps**: open any app on the TV.
- **Sleep**: turn the TV off.

**The card at the top** shows what is playing. Tap it to pause, play or skip.

**The phone's own volume buttons** change the TV's volume while Orbit is open. You can turn that off in Settings.

**Settings** (the gear) holds:
- **Language**: Orbit follows your phone's language. Pick another here; there are about 80.
- the pointer speed,
- the volume buttons,
- switching between the TV's homes,
- backups,
- **Forget this TV**.

Tip: in Cursor mode, a slower pointer speed in Settings makes small buttons easier to hit.

## 3. "Can't reach the TV"

Try these in order:

1. Check the TV is on and the phone is on the same Wi-Fi as the TV, then tap **Try again**.
2. **Did your router restart?** The router may have given the TV a new address.
   - The next version of Orbit finds the TV again by itself within about 15 seconds.
   - On older versions: open Settings › **Forget this TV**, choose the TV again in the list, and type the new code.
   - To stop this from happening at all, give the TV a fixed address in your router. Look for a setting called "DHCP reservation" or "static lease".
3. Press **Home** on the TV's own remote once, so the Orbit home screen (and its connection for the phone) is running.

## 4. Layout and wallpapers

Orbit Home has one layout today, and you can't set your own wallpaper yet. Both are on the [roadmap](../roadmap.md). If you'd like to build them, see [CONTRIBUTING](../../CONTRIBUTING.md). The home screen's code is in `launcher/`.

## 5. Undo

Settings › **Undo Orbit OS on this TV** puts the TV back the way it was before Orbit: its own home screen, and every app that was switched off. Nothing is deleted at any point.
