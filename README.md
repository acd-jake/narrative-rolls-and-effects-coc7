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
- Difficulty selection during modifier preparation for eligible checks

## Pushed-roll consequences

The GM can open the consequence editor from this module's settings. Entries belong to
one individual skill and specify a title, rules description, read-aloud text,
foreshadowing, and whether they apply while the investigator is insane. The editor
lists pushable skills from the system compendium and world actors/items; custom
skills and specializations can also be added by name. Save persists changes for the
current language in world settings. Reset restores the selected skill's defaults.
Description, read-aloud text, and foreshadowing use Foundry's ProseMirror editor;
their previews support Foundry text enrichers. The editor has no actor context, so
enrichers requiring an actor or roll data cannot be resolved there. Existing plain
text remains available and is converted to formatted text when edited.

The editor currently provides German and English defaults for Library Use and
Locksmith only; other skills start empty. Some entries describe game-mechanical
effects, but these are not selected or applied automatically during pushed rolls.
If a skill already has saved edits, its saved entries remain unchanged when defaults
are updated. Reset the skill and save to replace its edits with the current defaults.

## Dice visualization

The core Narrative Rolls and Effects module provides the shared dice visualizer, display template, and dice-face images. This companion module extends the core visuals with the CoC7 bonus and penalty dice; its prompts use the shared core display.

The core also manages the modifier-preparation prompt shell, while this module supplies its header and details.

## Compatibility

This module requires Foundry VTT v14 or later, the Call of Cthulhu 7th Edition system (`CoC7`), and the Narrative Rolls and Effects core module. It registers its adapter through the core `nre.registerAdapters` hook and is only active in a CoC7 world.

## License

This is an independent community project and is not affiliated with or endorsed by Chaosium Inc.
