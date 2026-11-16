# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to Semantic Versioning.

## [Unreleased]

### Added
- Standalone Call of Cthulhu 7th Edition companion module for Narrative Rolls and Effects.
- Hook-based adapter registration without cross-module ES imports.
- CoC7-specific result-display and success-level format settings.
- CoC7 bonus and penalty dice as an extension to the core dice visuals.
- CoC7-owned header and details for the core-managed modifier-preparation prompt.
- Difficulty selection during modifier preparation for eligible CoC7 checks.

### Changed
- Dice-face images, formula visualization, and the shared dice display are provided by the core module; CoC7 prompts now use that shared implementation.
