"""Format legality and timeline events (set rotations).

Rules (Disney Lorcana tournament rules / Fabled release notes):
  * Core Constructed: only cards from the sets inside the current rotation window.
    Legality is per card (name + version): if any printing of a card is in a Core-legal
    set, every printing of it is legal.
  * Infinity Constructed: every main set is legal, minus its own banned list.
  * Illumineer's Quest products are legal in neither format.

Update this file when a rotation happens or a ban list changes.
"""

# Lowest main-set number currently legal in Core Constructed (sets 9+ since 2026-07-17).
CORE_MIN_SET = 9

# Rotation events drawn on the timeline charts.
ROTATIONS = [
    {"date": "2025-08-29", "label": "Rotação: sai 1–4", "detail": "Fabled: coleções 1 a 4 saem do Core Constructed"},
    {"date": "2026-07-17", "label": "Rotação: sai 5–8", "detail": "Attack of the Vine!: coleções 5 a 8 saem do Core Constructed"},
]

# Card identities ("Name - Version") banned per format.
BANNED = {
    "core": set(),
    "infinity": {"Hiram Flaversham - Toymaker"},
}
