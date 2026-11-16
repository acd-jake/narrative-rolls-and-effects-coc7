# Narrative Rolls and Effects - Call of Cthulhu 7e

This companion module provides the Call of Cthulhu 7th Edition integration for Narrative Rolls and Effects. It registers a system adapter through the core `nre.registerAdapters` hook and does not import core module files.

## Requirements

- Foundry VTT v14 or later
- The Call of Cthulhu 7th Edition system (`CoC7`)
- Narrative Rolls and Effects

## Installation

Install and enable both Narrative Rolls and Effects and this companion module. The companion module is only active in a CoC7 world.

## Features

- Skill, characteristic, Luck, and Sanity checks
- Combined and opposed rolls
- Multi-phase melee and ranged combat
- System-specific prompt and chat-card layouts
- Configurable result display mode and success-level format
- Roll modifiers, Luck decisions, pushed rolls, and optional consequence automation
- Call of Cthulhu bonus and penalty dice in roll prompts and roll inspection

## Dice visualization

The core Narrative Rolls and Effects module provides the shared dice visualizer, display template, and dice-face images. This companion module extends the core visuals with the CoC7 bonus and penalty dice; its prompts use the shared core display.

## Compatibility

This module requires Foundry VTT v14 or later, the Call of Cthulhu 7th Edition system (`CoC7`), and the Narrative Rolls and Effects core module. It registers its adapter through the core `nre.registerAdapters` hook and is only active in a CoC7 world.

## License

This is an independent community project and is not affiliated with or endorsed by Chaosium Inc.
