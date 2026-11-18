import { PUSH_CONSEQUENCE_DEFAULTS_PART1 } from "./push-consequence-defaults-part1.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART2 } from "./push-consequence-defaults-part2.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART3 } from "./push-consequence-defaults-part3.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART4 } from "./push-consequence-defaults-part4.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART5 } from "./push-consequence-defaults-part5.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART6 } from "./push-consequence-defaults-part6.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART7 } from "./push-consequence-defaults-part7.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART8 } from "./push-consequence-defaults-part8.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART9 } from "./push-consequence-defaults-part9.mjs";
import { PUSH_CONSEQUENCE_DEFAULTS_PART10 } from "./push-consequence-defaults-part10.mjs";

const CORE_PUSH_CONSEQUENCE_DEFAULTS = {
    de: {
        "i.skill.library-use": [
            { insane: false, title: "Unerwünschte Aufmerksamkeit", description: "Der Archivar verweigert weiteren Zutritt und meldet das Interesse einem Informanten.", narration: "Ein Schatten fällt auf die aufgeschlagenen Register. Der Archivar notiert deinen Namen und weist dich hinaus.", foreshadowing: "Der Archivar beobachtet deinen Tisch bereits mit wachsendem Misstrauen." },
            { insane: false, title: "Zerstörter Beleg", description: "Ein wichtiges Dokument wird beschädigt; sein Hinweis ist hier nicht mehr lesbar.", narration: "Das brüchige Blatt zerreißt unter deinen Fingern. Die entscheidende Zeile bleibt als Staub auf dem Tisch zurück.", foreshadowing: "Das Papier ist so morsch, dass jede hastige Bewegung es zerreißen könnte." },
            { insane: false, title: "Falsche Spur", description: "Ein falsch zugeordneter Eintrag führt die Gruppe zu einem gefährlichen falschen Ort.", narration: "Im Register stimmen Datum und Name endlich überein. Erst am verschlossenen Tor wird klar, dass du zwei Akten verwechselt hast.", foreshadowing: "Zwei fast identische Namen stehen dicht nebeneinander im Register." },
            { insane: false, title: "Verheerender Fund", description: "Ein verstörender Augenzeugenbericht löst sofort eine Stabilitätsprobe (1/1W4 STA) aus.", narration: "Zwischen den vertrauten Akten liegt ein Bericht, dessen hastige Skizzen dich nicht mehr loslassen.", foreshadowing: "Eine Akte trägt eine Warnung: Der letzte Leser verließ den Saal kreidebleich." },
            { insane: false, title: "Verräterische Bestellung", description: "Die angeforderten Akten verraten das Ermittlungsziel einer feindlichen Partei.", narration: "Die Bestellkarte verschwindet durch den Schalter. Auf der anderen Seite reicht sie jemand wortlos an einen wartenden Fremden weiter.", foreshadowing: "Der Fremde am Schalter liest jede Bestellkarte, bevor sie abgelegt wird." },
            { insane: true, title: "Stimmen im Register", description: "Der Ermittler folgt einer vermeintlichen Botschaft und gibt seine Nachforschungen preis.", narration: "Zwischen den Einträgen flüstert dein Name. Du liest die Worte laut vor, bis sich im Saal alle Blicke auf dich richten.", foreshadowing: "Die Zeilen scheinen sich zu verschieben, sobald du sie aus den Augen lässt." },
            { insane: true, title: "Seiten voller Augen", description: "Der Ermittler zerstört das gesuchte Dokument; der Hinweis geht an diesem Fundort verloren.", narration: "Aus den Buchstaben starren dich Augen an. Du reißt die Seite heraus, doch das Rascheln verfolgt dich weiter.", foreshadowing: "Dunkle Flecken im Druck erinnern dich beunruhigend an Pupillen." },
            { insane: true, title: "Das falsche Geständnis", description: "Der Ermittler vertraut einem Unbeteiligten seine Verdächtigungen an; dieser alarmiert die Leitung.", narration: "Die Person neben dir muss es wissen. Deine Worte überschlagen sich, während sie langsam nach der Glocke greift.", foreshadowing: "Der Fremde scheint genau zuzuhören, obwohl er nicht zu dir herübersieht." },
            { insane: true, title: "Verfolgung zwischen Regalen", description: "Der Ermittler flieht aus dem Archiv und lässt seine mitgebrachten Notizen zurück.", narration: "Schritte folgen dir zwischen den Regalen. Du stürzt ins Freie; erst draußen bemerkst du, dass deine Notizen noch auf dem Tisch liegen.", foreshadowing: "Hinter jedem Regal knarrt das Holz, als folge dir jemand." },
            { insane: true, title: "Verbotene Ordnung", description: "Der Ermittler ordnet die Akten nach einem Wahnmuster um; der Zutritt wird ihm verweigert.", narration: "Nur die richtige Ordnung kann sie aufhalten. Als der Archivar dich findet, liegen offene Akten wie ein Zeichen auf dem Boden.", foreshadowing: "Die Signaturen wirken wie Teile eines Musters, das du unbedingt vervollständigen musst." }
        ],
        "i.skill.locksmith": [
            { insane: false, title: "Verborgene Nadel", description: "Eine Nadel im Schloss verursacht 1W3 TP Schaden; für einen Tag erhält der Ermittler einen Strafwürfel auf Geschicklichkeitsproben.", narration: "Ein metallisches Klicken, dann sticht etwas in deine Hand. Blut tropft auf den Schließzylinder.", foreshadowing: "Neben dem Schlüsselloch ragt eine feine Spitze aus dem Metall." },
            { insane: false, title: "Abgebrochener Dietrich", description: "Der Dietrich bricht im Schloss ab. Das Schloss bleibt blockiert, bis das Bruchstück entfernt ist; der Dietrich ist unbrauchbar.", narration: "Der Dietrich knackt und bleibt im Zylinder stecken. Das Schloss gibt keinen Millimeter mehr nach.", foreshadowing: "Der Dietrich biegt sich unter dem Widerstand des klemmenden Zylinders." },
            { insane: false, title: "Ausgelöster Alarm", description: "Der Mechanismus löst einen Alarm aus; die Wache nähert sich dem Schloss.", narration: "Hinter der Tür schnellt ein Riegel zurück. Eine Glocke schrillt durch das Gebäude.", foreshadowing: "Ein dünner Draht führt vom Schloss in die Dunkelheit hinter der Tür." },
            { insane: false, title: "Verräterische Spuren", description: "Der beschädigte Schließzylinder verrät den Einbruchsversuch; die Bewohner verständigen die Polizei.", narration: "Das Werkzeug reißt eine tiefe Kerbe ins Messing. Im Flur geht Licht an.", foreshadowing: "Das weiche Messing zeichnet jede Bewegung des Werkzeugs nach." },
            { insane: false, title: "Blockierter Riegel", description: "Der Riegel verkantet. Die Tür kann erst nach einer zeitaufwendigen Reparatur oder gewaltsam geöffnet werden.", narration: "Der Riegel fährt halb zurück und verklemmt sich mit einem dumpfen Schlag.", foreshadowing: "Der Riegel kratzt bereits bei der kleinsten Drehung am Türrahmen." },
            { insane: true, title: "Flüsterndes Schloss", description: "Der Ermittler hört Stimmen aus dem Schloss und ruft ihnen zu; eine Wache wird aufmerksam.", narration: "Aus dem Zylinder dringt ein Flüstern. Deine Antwort hallt durch den Gang, und Schritte kommen näher.", foreshadowing: "Das Kratzen der Stifte klingt für dich beinahe wie eine Stimme." },
            { insane: true, title: "Hand im Mechanismus", description: "Der Ermittler greift in den freigelegten Mechanismus und erleidet 1W3 TP Schaden; der Riegel bleibt verschlossen.", narration: "Du meinst, etwas im Schloss zurückweichen zu sehen. Als du danach greifst, schnappen die Federn über deiner Hand zu.", foreshadowing: "Hinter den Federn bewegt sich etwas, das dort nicht sein dürfte." },
            { insane: true, title: "Zeichen im Messing", description: "Der Ermittler zerkratzt das Schloss auf der Suche nach einem vermeintlichen Zeichen; sein Einbruchsversuch ist offensichtlich.", narration: "Die Kerben müssen ein Muster bilden. Erst als Licht auf das zerfurchte Messing fällt, bemerkst du die Gestalt hinter dir.", foreshadowing: "Die Kratzer im Messing scheinen sich zu einem Zeichen zu verbinden." },
            { insane: true, title: "Verriegelte Flucht", description: "Der Ermittler schlägt die Tür aus Angst zu; das Schloss verriegelt und der Rückweg ist blockiert.", narration: "Du wirfst die Tür hinter dir zu, um die vermeintlichen Verfolger auszusperren. Der Riegel rastet ein.", foreshadowing: "Aus dem Gang glaubst du hastige Schritte zu hören, obwohl niemand zu sehen ist." },
            { insane: true, title: "Misstrauen gegen das Werkzeug", description: "Der Ermittler zerstört seinen Dietrich; bis Ersatz gefunden ist, steht dieses Werkzeug nicht mehr zur Verfügung.", narration: "Der Dietrich fühlt sich in deiner Hand fremd und lebendig an. Mit einem Ruck zerbrichst du ihn.", foreshadowing: "Das kalte Metall scheint sich zwischen deinen Fingern leicht zu bewegen." }
        ]
    },
    en: {
        "i.skill.library-use": [
            { insane: false, title: "Unwanted Attention", description: "The archivist denies further access and reports the interest to an informant.", narration: "A shadow falls across the open registers. The archivist notes your name and shows you out.", foreshadowing: "The archivist watches your table with growing suspicion." },
            { insane: false, title: "Ruined Evidence", description: "An important document is damaged; its clue can no longer be read here.", narration: "The brittle sheet tears beneath your fingers. The crucial line crumbles to dust on the table.", foreshadowing: "The paper is so fragile that one hurried movement could tear it." },
            { insane: false, title: "False Lead", description: "A misfiled entry leads the group to a dangerous wrong location.", narration: "At last the date and name match. Only at the locked gate do you realize you confused two files.", foreshadowing: "Two nearly identical names sit side by side in the register." },
            { insane: false, title: "Devastating Discovery", description: "A disturbing eyewitness account immediately calls for a Sanity roll (1/1d4 SAN).", narration: "Among the familiar files lies an account whose hurried sketches refuse to leave your mind.", foreshadowing: "A file bears a warning: its last reader left the room pale as a ghost." },
            { insane: false, title: "Revealing Request", description: "The requested files reveal the investigation's target to a hostile party.", narration: "Your request slip vanishes through the hatch. On the other side, someone silently passes it to a waiting stranger.", foreshadowing: "The stranger at the desk reads every request slip before it is filed." },
            { insane: true, title: "Voices in the Register", description: "The investigator follows an imagined message and reveals the investigation.", narration: "Your name whispers between the entries. You read the words aloud until every face in the room turns toward you.", foreshadowing: "The lines seem to shift whenever you look away." },
            { insane: true, title: "Pages of Eyes", description: "The investigator destroys the sought document; its clue is lost at this location.", narration: "Eyes stare at you from the letters. You tear out the page, but the rustling follows you still.", foreshadowing: "Dark spots in the print look disturbingly like pupils." },
            { insane: true, title: "False Confession", description: "The investigator confides suspicions to a bystander, who alerts the staff.", narration: "The person beside you must know. Your words tumble out as they slowly reach for the bell.", foreshadowing: "The stranger seems to listen closely without looking your way." },
            { insane: true, title: "Pursuit Among Shelves", description: "The investigator flees the archive and leaves their notes behind.", narration: "Footsteps follow you between the shelves. You burst outside before realizing your notes are still on the table.", foreshadowing: "Behind every shelf, wood creaks as though someone were following." },
            { insane: true, title: "Forbidden Order", description: "The investigator rearranges files according to a delusion and is denied access.", narration: "Only the right order can stop them. When the archivist finds you, open files form a sign across the floor.", foreshadowing: "The shelf marks look like parts of a pattern you must complete." }
        ],
        "i.skill.locksmith": [
            { insane: false, title: "Hidden Needle", description: "A needle in the lock deals 1d3 HP damage; for one day the investigator takes a penalty die on Dexterity rolls.", narration: "A metallic click, then something stabs your hand. Blood drips onto the lock cylinder.", foreshadowing: "A fine point protrudes from the metal beside the keyhole." },
            { insane: false, title: "Broken Pick", description: "The pick breaks off in the lock. The lock remains jammed until the fragment is removed; the pick is unusable.", narration: "The pick snaps and sticks in the cylinder. The lock refuses to move another fraction.", foreshadowing: "The pick bends against the resistance of the sticking cylinder." },
            { insane: false, title: "Triggered Alarm", description: "The mechanism sets off an alarm; a guard approaches the lock.", narration: "A bolt springs back behind the door. A bell shrieks through the building.", foreshadowing: "A thin wire runs from the lock into the darkness behind the door." },
            { insane: false, title: "Telltale Damage", description: "The damaged cylinder reveals the attempted break-in; the occupants call the police.", narration: "The tool gouges a deep groove in the brass. A light comes on in the hall.", foreshadowing: "The soft brass records every movement of the tool." },
            { insane: false, title: "Jammed Bolt", description: "The bolt catches. The door can only be opened after a time-consuming repair or by force.", narration: "The bolt slides halfway back and jams with a dull thud.", foreshadowing: "The bolt scrapes against the frame at the slightest turn." },
            { insane: true, title: "Whispering Lock", description: "The investigator hears voices from the lock and calls back; a guard is alerted.", narration: "A whisper comes from the cylinder. Your answer echoes down the corridor, and footsteps approach.", foreshadowing: "The scraping pins sound almost like a voice." },
            { insane: true, title: "Hand in the Mechanism", description: "The investigator reaches into the exposed mechanism and takes 1d3 HP damage; the bolt remains locked.", narration: "You think you see something retreat inside the lock. When you reach for it, the springs snap shut on your hand.", foreshadowing: "Something moves behind the springs that should not be there." },
            { insane: true, title: "Sign in the Brass", description: "The investigator scratches the lock looking for an imagined sign; the attempted break-in is obvious.", narration: "The scratches must form a pattern. Only when light falls on the gouged brass do you notice the figure behind you.", foreshadowing: "The scratches in the brass seem to join into a sign." },
            { insane: true, title: "Locked Retreat", description: "The investigator slams the door in fear; the lock engages and blocks the way back.", narration: "You slam the door to shut out imagined pursuers. The bolt clicks into place.", foreshadowing: "You think you hear hurried footsteps in the hall, though nobody is there." },
            { insane: true, title: "Distrusted Tool", description: "The investigator destroys the lockpick; that tool is unavailable until replaced.", narration: "The pick feels strange and alive in your hand. You snap it in two.", foreshadowing: "The cold metal seems to move slightly between your fingers." }
        ]
    }
};
const PARTS = [
    CORE_PUSH_CONSEQUENCE_DEFAULTS,
    PUSH_CONSEQUENCE_DEFAULTS_PART1,
    PUSH_CONSEQUENCE_DEFAULTS_PART2,
    PUSH_CONSEQUENCE_DEFAULTS_PART3,
    PUSH_CONSEQUENCE_DEFAULTS_PART4,
    PUSH_CONSEQUENCE_DEFAULTS_PART5,
    PUSH_CONSEQUENCE_DEFAULTS_PART6,
    PUSH_CONSEQUENCE_DEFAULTS_PART7,
    PUSH_CONSEQUENCE_DEFAULTS_PART8,
    PUSH_CONSEQUENCE_DEFAULTS_PART9,
    PUSH_CONSEQUENCE_DEFAULTS_PART10
];
function mergeLanguageDefaults(language) {
    return Object.assign({}, ...PARTS.map((part) => part[language] ?? {}));
}
export const PUSH_CONSEQUENCE_DEFAULTS = {
    de: mergeLanguageDefaults("de"),
    en: mergeLanguageDefaults("en")
};
/** Returns a deep-cloned list of default consequences for a given language and skill key. */
export function getPushDefaults(language, skillId) {
    return (PUSH_CONSEQUENCE_DEFAULTS[language]?.[skillId] ?? []).map((entry) => ({ ...entry }));
}