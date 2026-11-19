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

## Aiming

Before the target decides whether to take cover, the attacker can fire without
aiming or spend a round aiming. The prompt waits until the next combat round;
without an active combat tracker, the Keeper confirms when the round has passed.
The first subsequent shot or volley gains one bonus die. Other actions outside
this module are not blocked automatically.

## Full-auto ranged attacks

Select Full Auto in the ranged attack prompt. After each volley and its damage
decision, fire again, switch to a scene token or a canvas target, or choose Cease
Fire. A volley uses up to one tenth of the attack skill in rounds, with a
minimum of three. Each later volley and each three metres or yards traversed adds
a penalty die. The prompt prevents firing when the combined modifier would exceed
two penalty dice; choose a closer target or cease fire. The weapon's ammunition
and malfunction state are updated immediately, unless the system ignores ammunition.

After each combat damage roll, the Keeper can apply or discard its consequences.
Ranged attacks wait for that decision before the next shot or volley. The Keeper-only
preview shows damage after armor, remaining hit points, and the resulting conditions;
discarding damage does not notify the attacker.
When automatic consequence application is enabled, damage is applied immediately.
Each client can choose automatic or manual ranged damage rolls; the Keeper can
enforce either choice for the whole world. Major wounds may require a separate
consciousness check, which the preview does not roll.

## Pushed-roll consequences

Only investigator actors (`character`) can spend Luck or push failed rolls; NPCs and creatures cannot.

When an investigator chooses to push an eligible roll, the Keeper can select a consequence in a dedicated selection window before the pushed roll is resolved:
- **Insanity pre-selection**: The dialog automatically detects whether the investigator is currently suffering from temporary or indefinite insanity and pre-selects the matching consequence list, which the Keeper can toggle at any time.
- **Presets, custom, or none**: Each entry displays its title and rules description so the Keeper can pick a fitting preset, enter a custom consequence for the current check, or proceed with no consequence.
- **Foreshadowing & post-resolution details**: Depending on the world setting (`showPushForeshadowingToPlayers`), players either see the push confirmation warning with the selected consequence's foreshadowing after the Keeper confirms, or see the warning immediately without waiting. While the check is unresolved, the Keeper sees a collapsible foreshadowing drawer in the prompt and chat card; once resolved, the foreshadowing is removed and—if the pushed roll failed—collapsible read-aloud narration (and rules description for the Keeper) is displayed according to `showPushNarrationToPlayers`.

The GM can open the consequence editor from this module's settings. Entries belong to one individual skill and specify a title, rules description, read-aloud text, foreshadowing, and whether they apply while the investigator is insane. The editor provides German and English defaults across all standard pushable CoC7 skills and specializations, and supports custom skills, Foundry's ProseMirror editor, and Foundry text enrichers.

## Dice visualization

The core Narrative Rolls and Effects module provides the shared dice visualizer, display template, and dice-face images. This companion module extends the core visuals with the CoC7 bonus and penalty dice; its prompts use the shared core display.

The core also manages the modifier-preparation prompt shell, while this module supplies its header and details.

## Compatibility

This module requires Foundry VTT v14 or later, the Call of Cthulhu 7th Edition system (`CoC7`), and the Narrative Rolls and Effects core module. It registers its adapter through the core `nre.registerAdapters` hook and is only active in a CoC7 world.

## License

This is an independent community project and is not affiliated with or endorsed by Chaosium Inc.
