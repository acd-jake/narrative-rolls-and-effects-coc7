# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to Semantic Versioning.

## [Unreleased]

### Added
- Damage consequence previews and immediate ranged damage rolls with client preferences and a Keeper override.
- Full-auto ranged volleys with target traverse penalties, ammunition tracking, and cease fire.
- Standalone Call of Cthulhu 7th Edition companion module for Narrative Rolls and Effects.
- Hook-based adapter registration without cross-module ES imports.
- CoC7-specific result-display and success-level format settings.
- CoC7 bonus and penalty dice as an extension to the core dice visuals.
- CoC7-owned header and details for the core-managed modifier-preparation prompt.
- Difficulty selection during modifier preparation for eligible CoC7 checks.
- Pushed-roll support for opposed checks alongside characteristic, skill, and combined checks according to Call of Cthulhu 7e rules.
- Added atmospheric waiting hints per CoC7 check type while the Keeper resolves the roll session.
- Configurable resolved combat prompt layout setting (`combatResolvedLayout`) supporting both narrative scene summaries and side-by-side duel comparisons with separated mechanical consequences.

### Changed
- The Keeper decides each combat damage roll before further ranged fire; previews are Keeper-only.
- Combat results now identify who receives the damage.
- Resolved chat cards now show the same results as roll prompts.
- Failed pushed checks are highlighted in prompts and chat cards to draw attention to their consequences.
- Pushed checks are now identified in roll prompts and chat cards.
- Declining Luck now finalizes the post-roll step so eligible sessions can resolve automatically.
- Refactored the CoC7 adapter into focused services while preserving its existing integration behavior.
- Dice-face images, formula visualization, and the shared dice display are provided by the core module; CoC7 prompts now use that shared implementation.
- CoC7 dice tooltips now group percentile units, tens, and bonus/penalty dice into one formula.
- Simplified resolved roll prompts across all CoC7 check types (skill, characteristic, custom, combined, opposed, sanity, and combat) to show context headers and color-coded outcomes without duplicate text.
- Allowed players to inspect roll details by clicking their visible success-level outcome during the waiting phase.
- Displayed the opponent's success level in prompts and chat cards regardless of roll visibility mode, while keeping rolled numbers and dice-breakdown inspection restricted.
- Allowed players to view and inspect their own roll outcome and details immediately while waiting for opponents or Keeper resolution.
- Placed a unified post-roll decline button below Luck and Push options with dynamic labels based on available choices.

### Fixed
- Prevent ranged damage previews from failing when Foundry expands saved actor UUID keys.
- Prevented accumulated ranged hits from being treated as a single lethal hit.
- Restored the display of resolved melee combat results.
- Kept modifier sliders in preparation and summarized active bonus or penalty dice in roll prompts.
- Pointed bonus and penalty dice visuals to this module's assets and marked chat cards with the CoC7 system identifier.
- Showed failed forced-roll consequences in the normal resolution step instead of a separate phase.
- Restored the expandable skill description in skill-check prompts.
