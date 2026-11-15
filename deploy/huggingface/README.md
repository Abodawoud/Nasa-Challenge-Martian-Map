---
title: Martian Map API
emoji: 🧭
colorFrom: red
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Heights, slopes and walking routes for Jezero Crater, Mars
---

# Martian Map API

The backend of **Martian Map**, the entry of team Red Compass for the NASA Space Apps Challenge 2026.

It answers questions about the ground of Jezero Crater on Mars, from the USGS height map (20 m per pixel): the height and slope of a place, several walking routes between two places with a score for each, and a walking-time map.

- Code and the full description: <https://github.com/Abodawoud/Nasa-Challenge-Martian-Map>
- Try it: open `/docs` on this Space for the list of addresses.

The height map is downloaded from USGS when the Space starts. It is not stored here.

It is a planning prototype. It is not a navigation system for a real mission.
