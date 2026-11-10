# Devices

One folder for each TV Orbit OS has been set up on and tested with.

| Folder | TV | System |
|---|---|---|
| [`xiaomi-mitv-axfu0`](xiaomi-mitv-axfu0) | Xiaomi TV A Pro, model code MiTV-AXFU0 | Google TV 14 |

Each folder holds:

- `debloat.txt`: the packages to switch off, one per line, grouped under comments that say why. Read it before
  you apply it: a line that suits one household can take away something another one uses.
- `theme/config.json`: the look, pushed with `tools/theme.sh`. Personal values (a name for the greeting, cloud
  keys) are added to the TV's own copy, never here.
- `README.md`: what is special about the TV: packages that must go together, buttons, what was measured.

To start a new TV, copy the closest folder, name it after the model code (Settings › System › About), and change
the list after reading what is on the TV: `TV_HOST=<tv ip> tools/tv.py "pm list packages"`.
