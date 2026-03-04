/**
 * Nexa - Gestion des filtres audio via lavalink-client FilterManager
 */

import {EQList, type Player} from "lavalink-client";

export interface FilterDef {
    id: string;
    label: string;
    emoji: string;
    description: string;
}

export const FILTERS: FilterDef[] = [
    {id: "nightcore", label: "Nightcore", emoji: "🌸", description: "Pitch + vitesse élevés"},
    {id: "vaporwave", label: "Vaporwave", emoji: "🌊", description: "Pitch + vitesse ralentis"},
    {id: "karaoke", label: "Karaoke", emoji: "🎤", description: "Suppression des voix"},
    {id: "rotation", label: "8D Audio", emoji: "🎧", description: "Rotation panoramique"},
    {id: "tremolo", label: "Tremolo", emoji: "〰️", description: "Oscillation du volume"},
    {id: "vibrato", label: "Vibrato", emoji: "🎻", description: "Oscillation du pitch"},
    {id: "lowpass", label: "Low Pass", emoji: "🔉", description: "Filtre passe-bas (doux)"},
    {id: "bassboost", label: "Bass Boost", emoji: "🔊", description: "Boost des basses"},
    {id: "pop", label: "Pop", emoji: "🎵", description: "Equalizer Pop"},
    {id: "rock", label: "Rock", emoji: "🎸", description: "Equalizer Rock"},
    {id: "electronic", label: "Electronic", emoji: "🎛️", description: "Equalizer Electronic"},
    {id: "gaming", label: "Gaming", emoji: "🎮", description: "Equalizer Gaming"},
];

/** Retourne les filtres actuellement actifs sous forme d'ensemble d'ids */
export function getActiveFilters(player: Player): Set<string> {
    const active = new Set<string>();
    const f = (player.filterManager as any).filters ?? {};
    if (f.nightcore) active.add("nightcore");
    if (f.vaporwave) active.add("vaporwave");
    if (f.karaoke) active.add("karaoke");
    if (f.rotation) active.add("rotation");
    if (f.tremolo) active.add("tremolo");
    if (f.vibrato) active.add("vibrato");
    if (f.lowPass) active.add("lowpass");
    // Détecter quel EQ preset est actif via le nom du preset
    const preset = (player.filterManager as any).equalizerPreset as string | undefined;
    if (preset) {
        const presetMap: Record<string, string> = {
            BassboostHigh: "bassboost",
            Pop: "pop",
            Rock: "rock",
            Electronic: "electronic",
            Gaming: "gaming",
        };
        const id = presetMap[preset];
        if (id) active.add(id);
        else active.add("_eq");
    } else {
        const eq = f.equalizer ?? [];
        if (eq.length > 0) active.add("_eq");
    }
    return active;
}

/** Synchronise les filtres du player selon la sélection complète reçue du select menu */
export async function applyFilterSet(player: Player, selectedIds: string[]): Promise<void> {
    const fm = player.filterManager;
    const selected = new Set(selectedIds);
    const active = getActiveFilters(player);

    // EQ presets — on reset d'abord, puis on applique celui sélectionné (un seul à la fois)
    const eqFilters = ["bassboost", "pop", "rock", "electronic", "gaming"];
    const selectedEq = eqFilters.find(id => selected.has(id));
    const activeEq = eqFilters.find(id => active.has(id) || active.has("_eq"));
    if (selectedEq !== activeEq) {
        await fm.clearEQ(); // reset EQ
        if (selectedEq) {
            switch (selectedEq) {
                case "bassboost":
                    await fm.setEQ(EQList.BassboostHigh);
                    break;
                case "pop":
                    await fm.setEQPreset("Pop");
                    break;
                case "rock":
                    await fm.setEQPreset("Rock");
                    break;
                case "electronic":
                    await fm.setEQPreset("Electronic");
                    break;
                case "gaming":
                    await fm.setEQPreset("Gaming");
                    break;
            }
        }
    }

    // Filtres toggle — activer/désactiver selon l'écart
    const toggleFilters: { id: string; activeKey: string; toggle: () => Promise<any> }[] = [
        {id: "nightcore", activeKey: "nightcore", toggle: () => fm.toggleNightcore()},
        {id: "vaporwave", activeKey: "vaporwave", toggle: () => fm.toggleVaporwave()},
        {id: "karaoke", activeKey: "karaoke", toggle: () => fm.toggleKaraoke()},
        {id: "rotation", activeKey: "rotation", toggle: () => fm.toggleRotation()},
        {id: "tremolo", activeKey: "tremolo", toggle: () => fm.toggleTremolo()},
        {id: "vibrato", activeKey: "vibrato", toggle: () => fm.toggleVibrato()},
        {id: "lowpass", activeKey: "lowpass", toggle: () => fm.toggleLowPass()},
    ];

    for (const {id, activeKey, toggle} of toggleFilters) {
        const isActive = active.has(activeKey);
        const shouldBeActive = selected.has(id);
        if (isActive !== shouldBeActive) await toggle();
    }
}



