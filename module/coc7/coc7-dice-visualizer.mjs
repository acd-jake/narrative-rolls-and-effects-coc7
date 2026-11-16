const DICE_ASSET_PATH = "modules/narrative-rolls-and-effects-coc7/assets/dice";

const DIE_TYPES = Object.freeze({
    2: { file: "d2", label: "ROE_COC7.Dice.Coin" },
    4: { file: "d4", label: "ROE_COC7.Dice.D4" },
    6: { file: "d6", label: "ROE_COC7.Dice.D6" },
    8: { file: "d8", label: "ROE_COC7.Dice.D8" },
    10: { file: "d10-units", label: "ROE_COC7.Dice.D10Units" },
    12: { file: "d12", label: "ROE_COC7.Dice.D12" },
    20: { file: "d20", label: "ROE_COC7.Dice.D20" }
});

export class CoC7DiceVisualizer {
    static percentile(modifierDice = 0) {
        const modifier = Math.clamp(Number(modifierDice) || 0, -2, 2);
        const dice = [
            { src: `${DICE_ASSET_PATH}/d10-units.svg`, label: "ROE_COC7.Dice.D10Units", count: 1, multiple: false },
            { src: `${DICE_ASSET_PATH}/d10-tens.svg`, label: "ROE_COC7.Dice.D10Tens", count: 1, multiple: false }
        ];
        for (let i = 0; i < Math.abs(modifier); i++) {
            dice.push({
                src: `${DICE_ASSET_PATH}/${modifier > 0 ? "d10-bonus" : "d10-penalty"}.svg`,
                label: modifier > 0 ? "ROE.Roll.BonusDie" : "ROE.Roll.PenaltyDie",
                count: 1,
                multiple: false
            });
        }
        return dice;
    }

    static fromFormula(formula) {
        if (!formula || typeof formula !== "string") return [];
        try {
            return new foundry.dice.Roll(formula).dice.flatMap((die) => {
                const count = Number(die.number);
                if (!Number.isFinite(count) || count <= 0) return [];
                if (die.faces === 100) return this.percentile(0);
                const type = DIE_TYPES[die.faces];
                return type ? [{ src: `${DICE_ASSET_PATH}/${type.file}.svg`, label: type.label, count, multiple: count > 1 }] : [];
            });
        } catch {
            return [];
        }
    }
}
